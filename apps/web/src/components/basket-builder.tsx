"use client";

import {
  baseUnitsToDecimal,
  basketPackageRecordSchema,
  calculateCommercialPlanSnapshotSpend,
  calculateScenarioForecast,
  calculateScenarioSpend,
  commercialPlanApprovalRecordSchema,
  commercialPlanReviewSchema,
  decimalToBaseUnits,
  evaluateBasketScenarioApproval,
  saveBasketOutcomeInputSchema,
  type BasketOutcomeMetric,
  type BasketOutcomeProfile,
  type BasketApprovalEvaluation,
  type BasketPackageRecord,
  type BasketRecord,
  type CommercialPlanApprovalRecord,
  type CommercialPlanReview,
  type CommercialPlanSnapshot,
  type ExactCurrencyTotal,
  type ScenarioForecastSummary,
  type ScenarioSpendSummary,
} from "@landed/contracts";
import {
  type FormEvent,
  Fragment,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { project } from "@/lib/demo-data";
import {
  BasketTimingPanel,
  type TimingPanelStatus,
} from "./basket-timing-panel";
import {
  BasketWorkspace,
  type OpenPlanPanel,
  type PlanPanel,
  type PlanPanelId,
} from "./basket-workspace";
import { PlanCandidates } from "./plan-candidates";
import {
  PlanForecast,
  costPerQualifiedWallet,
  formatWholeAmount,
} from "./plan-forecast";
import { PlanStepsCard, type PlanStep } from "./plan-steps-card";
import { PlanRevisionAction } from "./plan-revision-action";
import plan from "./campaign-plan.module.css";
import {
  BasketStrategyEditor,
  type StrategyReviewState,
} from "./basket-strategy-editor";
import type { BasketMeasurementChoices } from "@/lib/baskets/measurement-choices";
import type { LocalCommercialMode } from "./browser-commercial-review";

function withScenarioPackage(
  scenarios: BasketRecord["scenarios"],
  scenarioId: string,
  packageId: string,
  included: boolean,
) {
  return scenarios.map((scenario) =>
    scenario.id === scenarioId
      ? {
          ...scenario,
          packageIds: included
            ? Array.from(new Set([...scenario.packageIds, packageId]))
            : scenario.packageIds.filter((id) => id !== packageId),
        }
      : scenario,
  );
}

type EditableCompensationLine = {
  key: string;
  assetType: "cash" | "usdc" | "token";
  model: "fixed" | "variable";
  variableUnit: string;
  amount: string;
  currencyCode: "GBP" | "USD" | "EUR";
  tokenMint: string;
  tokenDecimals: string;
  unitPriceUsd: string;
  priceSource: string;
  valuedAt: string;
};

function emptyCompensationLine(key: string): EditableCompensationLine {
  return {
    key,
    assetType: "cash",
    model: "fixed",
    variableUnit: "",
    amount: "",
    currencyCode: "GBP",
    tokenMint: "",
    tokenDecimals: "6",
    unitPriceUsd: "1",
    priceSource: "",
    valuedAt: "",
  };
}

function trimStoredDecimal(value: string) {
  return value.includes(".")
    ? value.replace(/0+$/, "").replace(/\.$/, "")
    : value;
}

function storedLineToEditable(
  line: BasketPackageRecord["compensationLines"][number],
): EditableCompensationLine {
  if (line.assetType === "cash") {
    return {
      ...emptyCompensationLine(line.id),
      assetType: "cash",
      model: line.model,
      variableUnit: line.variableUnit ?? "",
      amount: baseUnitsToDecimal(line.amountMinor, 2),
      currencyCode: line.currencyCode,
    };
  }

  return {
    ...emptyCompensationLine(line.id),
    assetType: line.assetType,
    model: line.model,
    variableUnit: line.variableUnit ?? "",
    amount: baseUnitsToDecimal(line.tokenAmountRaw, line.tokenDecimals),
    tokenMint: line.tokenMint,
    tokenDecimals: String(line.tokenDecimals),
    unitPriceUsd: trimStoredDecimal(line.unitPriceUsd),
    priceSource: line.priceSource,
    valuedAt: line.valuedAt.slice(0, 16),
  };
}

function reviewCompensationLine(
  line:
    | CommercialPlanSnapshot["packages"][number]["compensationLines"][number]
    | BasketPackageRecord["compensationLines"][number],
) {
  const model =
    line.model === "variable"
      ? `variable · per ${line.variableUnit ?? "unspecified unit"}`
      : "fixed";

  if (line.assetType === "cash") {
    return {
      evidence: `${line.currencyCode} cash`,
      value: `${line.currencyCode} ${baseUnitsToDecimal(line.amountMinor, 2)} · ${model}`,
    };
  }

  return {
    evidence: `Mint ${line.tokenMint} · unit price USD ${trimStoredDecimal(
      line.unitPriceUsd,
    )} · ${line.priceSource} · valued ${line.valuedAt}`,
    value: `${line.assetType === "usdc" ? "USDC" : "Token"} ${baseUnitsToDecimal(
      line.tokenAmountRaw,
      line.tokenDecimals,
    )} · ${model}`,
  };
}

/** Plan wording for the contract's approval blockers; unknown codes keep the
 * contract message. Presentation only: eligibility is unchanged. */
function planBlockerText(blocker: { code: string; message: string }) {
  return (
    {
      deliverable_missing: "Add what this creator will deliver.",
      commercial_terms_incomplete: "Add complete payment terms.",
      outcome_missing: "Set the target.",
      roster_empty: "Include at least one creator in this scenario.",
    }[blocker.code] ?? blocker.message
  );
}

function formatExactCurrency(total: ExactCurrencyTotal) {
  const [whole, fraction] = total.amount.split(".");
  const groupedWhole = whole?.replace(/\B(?=(\d{3})+(?!\d))/g, ",") ?? "0";
  const symbol = {
    EUR: "€",
    GBP: "£",
    USD: "$",
  }[total.currencyCode];

  return `${symbol}${groupedWhole}${
    fraction && /[1-9]/.test(fraction) ? `.${fraction.padEnd(2, "0")}` : ""
  }`;
}

function scenarioSpendLabel(summary: ScenarioSpendSummary) {
  if (summary.status === "single_currency" && summary.fixedTotals[0]) {
    return formatExactCurrency(summary.fixedTotals[0]);
  }

  return {
    empty: "No creators",
    incomplete: "Partial · terms missing",
    mixed_currency: "Mixed currencies",
    single_currency: "Partial · terms missing",
    unpaid: "Unpaid test",
    variable_only: "Variable only",
  }[summary.status];
}

const outcomeMetricLabels: Record<BasketOutcomeMetric, string> = {
  qualified_wallets: "Qualified wallet additions",
  average_order_value: "Average order value",
  verified_revenue: "Verified revenue",
};

function outcomeValue(
  units: string,
  metric: BasketOutcomeMetric,
  currencyCode: BasketOutcomeProfile["currencyCode"],
) {
  if (metric === "qualified_wallets") {
    return `${units} WALLETS`;
  }

  const symbol = { EUR: "€", GBP: "£", USD: "$" }[currencyCode ?? "GBP"];

  return `${symbol}${baseUnitsToDecimal(units, 2)}`;
}

/*
 * UI-03 · numerical target input. Values are checked as text before any
 * conversion: whole wallet counts, or money with at most two decimal places.
 * Nothing is stripped, rounded or passed through floating-point numbers; the
 * accepted text goes through the same BigInt / base-unit conversion as before.
 */
type OutcomeValueField = "baseline" | "target";
export const outcomeValueMessages = {
  wholeNumber: "Enter a whole number, like 250.",
  amount: "Enter an amount with up to two decimal places, like 25.50.",
  aboveZero: "Enter a target greater than zero.",
} as const;
const wholeNumberText = /^\d+$/;
// Matches decimalToBaseUnits' accepted form, limited to two decimal places.
const amountText = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function parseOutcomeValue(
  raw: string,
  metric: BasketOutcomeMetric,
  field: OutcomeValueField,
): { units: string } | { error: string } {
  const value = raw.trim();
  let units: string;
  if (metric === "qualified_wallets") {
    if (!wholeNumberText.test(value))
      return { error: outcomeValueMessages.wholeNumber };
    units = BigInt(value).toString();
  } else {
    if (!amountText.test(value)) return { error: outcomeValueMessages.amount };
    units = decimalToBaseUnits(value, 2);
  }
  if (field === "target" && BigInt(units) === 0n)
    return { error: outcomeValueMessages.aboveZero };
  return { units };
}

const outcomeSaveUnconfirmed =
  "We couldn't confirm whether the outcome was saved. Check your connection, then reload this page to see the saved outcome before trying again.";
// Only intentional rejections from the outcome route are safe to show verbatim.
const outcomeRejections: Record<number, string> = {
  400: "Outcome setup was not valid.",
  403: "Outcome changes require campaign manager access.",
  404: "Basket was not found.",
};

export function OutcomeSetup({
  basketId,
  initialObjective,
  initialProfile,
  onSaved,
  savedGoal,
  guided = false,
  readOnly = false,
}: {
  basketId: string;
  initialObjective: string | null;
  initialProfile: BasketOutcomeProfile | null;
  onSaved: (objective: string, profile: BasketOutcomeProfile) => void;
  savedGoal?: string | null;
  guided?: boolean;
  /** Viewers see the saved target without an edit form. */
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(initialProfile === null);
  const [objective, setObjective] = useState(initialObjective ?? "");
  const [metric, setMetric] = useState<BasketOutcomeMetric>(
    initialProfile?.metric ?? "qualified_wallets",
  );
  const [baseline, setBaseline] = useState(
    initialProfile
      ? initialProfile.metric === "qualified_wallets"
        ? initialProfile.baselineUnits
        : baseUnitsToDecimal(initialProfile.baselineUnits, 2)
      : "",
  );
  const [target, setTarget] = useState(
    initialProfile
      ? initialProfile.metric === "qualified_wallets"
        ? initialProfile.targetUnits
        : baseUnitsToDecimal(initialProfile.targetUnits, 2)
      : "",
  );
  const [currencyCode, setCurrencyCode] = useState<"GBP" | "USD" | "EUR">(
    initialProfile?.currencyCode ?? "GBP",
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<OutcomeValueField, string>>
  >({});
  const form = useRef<HTMLFormElement>(null);
  const fieldId = useId();

  async function saveOutcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");

    // Local validation first: an invalid value never sends a request.
    const baselineValue = parseOutcomeValue(baseline, metric, "baseline");
    const targetValue = parseOutcomeValue(target, metric, "target");
    const errors: Partial<Record<OutcomeValueField, string>> = {};
    if ("error" in baselineValue) errors.baseline = baselineValue.error;
    if ("error" in targetValue) errors.target = targetValue.error;
    setFieldErrors(errors);
    if ("error" in baselineValue || "error" in targetValue) {
      const first = errors.baseline ? "baseline" : "target";
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLInputElement>(`[name="outcome-${first}"]`)
          ?.focus(),
      );
      return;
    }

    const isWalletMetric = metric === "qualified_wallets";
    const profile: BasketOutcomeProfile = {
      metric,
      baselineUnits: baselineValue.units,
      targetUnits: targetValue.units,
      currencyCode: isWalletMetric ? null : currencyCode,
    };
    setSaving(true);

    try {
      const response = await fetch(
        `/api/projects/${project.id}/baskets/${basketId}/outcome`,
        {
          body: JSON.stringify({
            objective: objective.trim(),
            outcomeProfile: profile,
          }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        },
      );
      const payload: unknown = await response.json();

      if (!response.ok) {
        setNotice(
          payload !== null &&
            typeof payload === "object" &&
            !Array.isArray(payload) &&
            "message" in payload &&
            typeof payload.message === "string" &&
            payload.message === outcomeRejections[response.status]
            ? payload.message
            : outcomeSaveUnconfirmed,
        );
        return;
      }

      // A 2xx status alone is not confirmation of these exact persisted inputs.
      const saved = saveBasketOutcomeInputSchema.safeParse(payload);
      if (
        !saved.success ||
        saved.data.objective !== objective.trim() ||
        saved.data.outcomeProfile.metric !== profile.metric ||
        saved.data.outcomeProfile.baselineUnits !== profile.baselineUnits ||
        saved.data.outcomeProfile.targetUnits !== profile.targetUnits ||
        saved.data.outcomeProfile.currencyCode !== profile.currencyCode
      ) {
        setNotice(outcomeSaveUnconfirmed);
        return;
      }

      onSaved(objective.trim(), profile);
      setEditing(false);
      setNotice("Target saved.");
    } catch {
      // A sent request or a local callback error cannot establish rollback.
      setNotice(outcomeSaveUnconfirmed);
    } finally {
      setSaving(false);
    }
  }

  if (readOnly && !(initialProfile && initialObjective)) {
    return (
      <section
        className={plan.outcomeDefined}
        aria-label="Campaign outcome"
        id="basket-outcome"
        tabIndex={-1}
      >
        <p>No target is set yet. Only a campaign manager can set it.</p>
      </section>
    );
  }

  if ((readOnly || !editing) && initialProfile && initialObjective) {
    return (
      <section
        className={plan.outcomeDefined}
        aria-label="Campaign outcome"
        id="basket-outcome"
        tabIndex={-1}
      >
        <p className={plan.small}>Saved target</p>
        <h3 className={plan.outcomeObjective}>{initialObjective}</h3>
        <p className={plan.small}>
          {outcomeMetricLabels[initialProfile.metric]}
        </p>
        <dl className={plan.outcomeValues}>
          <div>
            <dt>Baseline</dt>
            <dd>
              {outcomeValue(
                initialProfile.baselineUnits,
                initialProfile.metric,
                initialProfile.currencyCode,
              ).toLowerCase()}
            </dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>
              {outcomeValue(
                initialProfile.targetUnits,
                initialProfile.metric,
                initialProfile.currencyCode,
              ).toLowerCase()}
            </dd>
          </div>
        </dl>
        {readOnly ? null : (
          <button
            className={plan.button}
            onClick={() => setEditing(true)}
            type="button"
          >
            Edit target
          </button>
        )}
        {notice ? (
          <p className={plan.inlineSuccess} role="status">
            {notice}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <form
      className={plan.form}
      id="basket-outcome"
      ref={form}
      tabIndex={-1}
      onSubmit={saveOutcome}
      aria-label="Set the target"
    >
      {guided ? (
        <div className={plan.formIntro}>
          <p>
            Your goal describes the change you want. Add a baseline and a target
            below. It’s a goal, not a predicted result.
          </p>
          {savedGoal ? (
            <div className={plan.savedGoal}>
              <p style={{ overflowWrap: "anywhere" }}>
                Saved goal: {savedGoal}
              </p>
              {savedGoal.length <= 240 ? (
                <button
                  type="button"
                  className={plan.button}
                  disabled={saving || objective === savedGoal}
                  onClick={() => {
                    if (
                      objective &&
                      !window.confirm(
                        "Replace the objective wording with your saved plan goal? Your numerical target and rule choice will not change. Save the target to keep the wording.",
                      )
                    )
                      return;
                    setObjective(savedGoal);
                  }}
                >
                  {objective === savedGoal
                    ? "Using saved goal"
                    : "Use saved goal"}
                </button>
              ) : (
                <p>
                  Your saved goal is longer than the 240-character objective
                  limit. Write a short summary below; the full goal stays in
                  Goal and audience.
                </p>
              )}
            </div>
          ) : (
            <p>
              Save your goal in <a href="#basket-strategy">Goal and audience</a>{" "}
              to reuse it here, or write an objective below.
            </p>
          )}
        </div>
      ) : null}
      <div className={plan.fields}>
        <label className={plan.fieldWide}>
          <span>
            Campaign objective
            <span
              className="required-field-marker"
              aria-hidden="true"
              title="Required"
            />
          </span>
          <input
            maxLength={240}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Increase order value from qualified wallets"
            required
            value={objective}
          />
        </label>
        <label className={plan.fieldWide}>
          <span>Primary KPI</span>
          <select
            onChange={(event) => {
              setMetric(event.target.value as BasketOutcomeMetric);
              // The accepted format depends on the KPI; re-check on save.
              setFieldErrors({});
            }}
            value={metric}
          >
            <option value="qualified_wallets">Qualified wallets</option>
            <option value="average_order_value">Average order value</option>
            <option value="verified_revenue">Verified revenue</option>
          </select>
        </label>
        {(
          [
            ["baseline", "Baseline", baseline, setBaseline],
            ["target", "Target", target, setTarget],
          ] as const
        ).map(([field, label, value, setValue]) => {
          const error = fieldErrors[field];
          const errorId = `${fieldId}-${field}-error`;
          return (
            <div key={field} className={plan.field}>
              <label>
                <span>
                  {label}
                  <span
                    className="required-field-marker"
                    aria-hidden="true"
                    title="Required"
                  />
                </span>
                <input
                  aria-describedby={error ? errorId : undefined}
                  aria-invalid={error ? true : undefined}
                  autoComplete="off"
                  inputMode={
                    metric === "qualified_wallets" ? "numeric" : "decimal"
                  }
                  name={`outcome-${field}`}
                  onChange={(event) => {
                    setValue(event.target.value);
                    if (error)
                      setFieldErrors((current) => ({
                        ...current,
                        [field]: undefined,
                      }));
                  }}
                  required
                  value={value}
                />
              </label>
              {error ? (
                <p className={plan.fieldError} id={errorId} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
        {metric === "qualified_wallets" ? null : (
          <label className={plan.field}>
            <span>Currency</span>
            <select
              onChange={(event) =>
                setCurrencyCode(event.target.value as "GBP" | "USD" | "EUR")
              }
              value={currencyCode}
            >
              <option value="GBP">GBP</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
        )}
      </div>
      {notice ? (
        <p className={plan.inlineAlert} role="alert">
          {notice}
        </p>
      ) : null}
      <footer className={plan.formFoot}>
        {initialProfile ? (
          <button
            className={plan.button}
            onClick={() => setEditing(false)}
            type="button"
          >
            Cancel
          </button>
        ) : null}
        <button
          className={`${plan.button} ${plan.buttonHero}`}
          disabled={saving}
          type="submit"
        >
          {saving ? "Saving target…" : "Save target"}
        </button>
      </footer>
    </form>
  );
}

function PackageTermsSummary({
  creatorPackage,
}: {
  creatorPackage: BasketPackageRecord;
}) {
  const detail = creatorPackage.commercialDetail;
  const unpaid =
    detail?.schemaVersion === 2 &&
    detail.commercialBasis === "unpaid_internal_test";
  const specified = (value?: string | null) =>
    value?.trim() ? value : "Not specified";
  const channels =
    detail?.channelIds.map((id) => {
      const channel = creatorPackage.availableChannels?.find(
        (item) => item.id === id,
      );
      return channel
        ? `${channel.channelType.toUpperCase()} · ${channel.handle}`
        : "Selected channel details unavailable";
    }) ?? [];

  return (
    <section
      aria-label={`Saved terms for ${creatorPackage.creatorName}`}
      className={plan.termsSummary}
    >
      <div className={plan.termsOverview}>
        <dl>
          <div>
            <dt>Package label</dt>
            <dd>{specified(creatorPackage.packageLabel)}</dd>
          </div>
          <div>
            <dt>Deliverable summary</dt>
            <dd>{specified(creatorPackage.deliverableSummary)}</dd>
          </div>
        </dl>
        <section
          aria-label="Compensation terms"
          className={plan.termsCompensation}
        >
          <h3>Compensation terms</h3>
          <p className={plan.small}>Saved amounts, not payments.</p>
          {creatorPackage.compensationLines.length ? (
            <dl>
              {creatorPackage.compensationLines.map((line, index) => {
                const display = reviewCompensationLine(line);
                return (
                  <div key={line.id}>
                    <dt>Compensation line {index + 1}</dt>
                    <dd>
                      <strong>{display.value}</strong>
                      {line.assetType !== "cash" && (
                        <details>
                          <summary>Token valuation</summary>
                          {display.evidence}
                        </details>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : (
            <p>
              {unpaid
                ? "No compensation or payment commitment."
                : "No compensation lines recorded. Cost is not confirmed."}
            </p>
          )}
        </section>
      </div>
      <h3>Delivery and rights</h3>
      <dl className={plan.termsDetails}>
        <div>
          <dt>Commercial basis</dt>
          <dd>
            {unpaid
              ? "Unpaid internal test"
              : detail?.schemaVersion === 2 ||
                  creatorPackage.compensationLines.length > 0
                ? "Paid compensation"
                : "Not specified"}
          </dd>
        </div>
        {unpaid && (
          <div>
            <dt>Why this test is unpaid</dt>
            <dd>{specified(detail.unpaidReason)}</dd>
          </div>
        )}
        <div>
          <dt>Package channels</dt>
          <dd>{channels.length ? channels.join(", ") : "Not specified"}</dd>
        </div>
        <div>
          <dt>Delivery deadline (UTC)</dt>
          <dd>
            {detail?.deliveryDeadline ? (
              <>
                <time dateTime={detail.deliveryDeadline}>
                  {new Intl.DateTimeFormat("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  }).format(new Date(detail.deliveryDeadline))}{" "}
                  UTC
                </time>
                <details>
                  <summary>Exact deadline</summary>
                  {detail.deliveryDeadline}
                </details>
              </>
            ) : (
              "Not specified"
            )}
          </dd>
        </div>
        <div>
          <dt>Usage rights</dt>
          <dd>{specified(detail?.usageRights)}</dd>
        </div>
        <div>
          <dt>Exclusivity</dt>
          <dd>{specified(detail?.exclusivity)}</dd>
        </div>
      </dl>
      <p className={plan.small}>
        Not specified is not permission or an agreement to no exclusivity.
      </p>
    </section>
  );
}

function PackageTermsEditor({
  basketId,
  creatorPackage,
  onCancel,
  onSaved,
  readOnly = false,
}: {
  basketId: string;
  creatorPackage: BasketPackageRecord;
  onCancel?: () => void;
  onSaved: (creatorPackage: BasketPackageRecord) => void;
  /** Viewers can read every term but get no editable fields or save. */
  readOnly?: boolean;
}) {
  const lineSequence = useRef(creatorPackage.compensationLines.length + 1);
  const [packageLabel, setPackageLabel] = useState(creatorPackage.packageLabel);
  const [deliverableSummary, setDeliverableSummary] = useState(
    creatorPackage.deliverableSummary ?? "",
  );
  const originalDetail = creatorPackage.commercialDetail;
  const [commercialBasis, setCommercialBasis] = useState<
    "compensated" | "unpaid_internal_test"
  >(
    originalDetail?.schemaVersion === 2
      ? originalDetail.commercialBasis
      : "compensated",
  );
  const [unpaidReason, setUnpaidReason] = useState(
    originalDetail?.schemaVersion === 2
      ? (originalDetail.unpaidReason ?? "")
      : "",
  );
  const [channelIds, setChannelIds] = useState(
    originalDetail?.channelIds ?? [],
  );
  const [deadline, setDeadline] = useState(
    originalDetail?.deliveryDeadline?.slice(0, 16) ?? "",
  );
  const [usageRights, setUsageRights] = useState(
    originalDetail?.usageRights ?? "",
  );
  const [exclusivity, setExclusivity] = useState(
    originalDetail?.exclusivity ?? "",
  );
  const [lines, setLines] = useState<EditableCompensationLine[]>(() =>
    creatorPackage.compensationLines.length > 0
      ? creatorPackage.compensationLines.map(storedLineToEditable)
      : originalDetail?.schemaVersion === 2 &&
          originalDetail.commercialBasis === "unpaid_internal_test"
        ? []
        : [emptyCompensationLine("new-1")],
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  function updateLine(key: string, update: Partial<EditableCompensationLine>) {
    setNotice("");
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...update } : line)),
    );
  }

  function addLine() {
    if (lines.length >= 5) {
      return;
    }

    setNotice("");
    lineSequence.current += 1;
    setLines((current) => [
      ...current,
      emptyCompensationLine(`new-${lineSequence.current}`),
    ]);
  }

  async function saveTerms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice("");

    const compensationLines = (
      commercialBasis === "unpaid_internal_test" ? [] : lines
    ).map((line) =>
      line.assetType === "cash"
        ? {
            assetType: "cash" as const,
            model: line.model,
            variableUnit:
              line.model === "variable" ? line.variableUnit.trim() : null,
            amount: line.amount.trim(),
            currencyCode: line.currencyCode,
          }
        : {
            assetType: line.assetType,
            model: line.model,
            variableUnit:
              line.model === "variable" ? line.variableUnit.trim() : null,
            amount: line.amount.trim(),
            tokenMint: line.tokenMint.trim(),
            tokenDecimals: Number(line.tokenDecimals),
            unitPriceUsd: line.unitPriceUsd.trim(),
            priceSource: line.priceSource.trim(),
            valuedAt: line.valuedAt
              ? new Date(line.valuedAt).toISOString()
              : "",
          },
    );

    try {
      const response = await fetch(
        `/api/projects/${project.id}/baskets/${basketId}/packages/${creatorPackage.id}`,
        {
          body: JSON.stringify({
            packageLabel: packageLabel.trim(),
            deliverableSummary: deliverableSummary.trim() || null,
            compensationLines,
            ...(creatorPackage.commercialDetailRevision
              ? {
                  expectedDetailRevision:
                    creatorPackage.commercialDetailRevision,
                  commercialDetail: {
                    schemaVersion: 2,
                    channelIds,
                    deliveryDeadline:
                      deadline ===
                      (originalDetail?.deliveryDeadline?.slice(0, 16) ?? "")
                        ? (originalDetail?.deliveryDeadline ?? null)
                        : deadline
                          ? `${deadline}:00Z`
                          : null,
                    usageRights: usageRights.trim() || null,
                    exclusivity: exclusivity.trim() || null,
                    commercialBasis,
                    unpaidReason:
                      commercialBasis === "unpaid_internal_test"
                        ? unpaidReason.trim() || null
                        : null,
                  },
                }
              : {}),
          }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        },
      );
      const payload = (await response.json()) as {
        message?: unknown;
        package?: unknown;
      };

      const savedPackage = basketPackageRecordSchema.safeParse(payload.package);

      if (!response.ok || !savedPackage.success) {
        setNotice(
          !response.ok && typeof payload.message === "string"
            ? payload.message
            : response.ok
              ? "We couldn’t confirm whether the terms were saved. Reload the page to check the saved terms before trying again."
              : "The terms weren’t saved.",
        );
        return;
      }

      onSaved(savedPackage.data);
      setNotice("Terms saved. The scenario total is updated.");
    } catch {
      setNotice(
        "We couldn’t confirm whether the terms were saved. Check your connection, then reload the page to check the saved terms before trying again.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (readOnly) return <PackageTermsSummary creatorPackage={creatorPackage} />;

  return (
    <form
      aria-label={`Commercial terms for ${creatorPackage.creatorName}`}
      className="package-terms package-terms--inline"
      id={`package-terms-${creatorPackage.id}`}
      onSubmit={(event) => {
        if (readOnly) {
          event.preventDefault();
          return;
        }
        void saveTerms(event);
      }}
    >
      <fieldset className={plan.plainFieldset} disabled={readOnly}>
        <header className="package-terms__header">
          <p className={plan.small}>
            Store the exact terms. The scenario total updates from what’s saved,
            without estimating variable results or converting currencies.
          </p>
          {onCancel ? (
            <button className={plan.button} onClick={onCancel} type="button">
              Close
            </button>
          ) : null}
        </header>

        <div className="package-terms__definition">
          <label>
            <span>
              Package label
              <span
                className="required-field-marker"
                aria-hidden="true"
                title="Required"
              />
            </span>
            <input
              maxLength={120}
              onChange={(event) => {
                setNotice("");
                setPackageLabel(event.target.value);
              }}
              required
              value={packageLabel}
            />
          </label>
          <label>
            <span>
              Deliverable summary
              <span
                className="required-field-marker"
                aria-hidden="true"
                title="Required"
              />
            </span>
            <input
              maxLength={240}
              onChange={(event) => {
                setNotice("");
                setDeliverableSummary(event.target.value);
              }}
              placeholder="Define deliverables before approval"
              aria-required="true"
              data-required-missing={!deliverableSummary.trim()}
              value={deliverableSummary}
            />
          </label>
        </div>

        {creatorPackage.commercialDetailRevision && (
          <fieldset className="package-terms__definition" disabled={saving}>
            <legend>Commercial basis</legend>
            <label>
              <span>Package basis</span>
              <select
                aria-label="Commercial basis"
                autoComplete="off"
                name="commercialBasis"
                value={commercialBasis}
                onChange={(event) => {
                  const nextBasis = event.target.value as
                    "compensated" | "unpaid_internal_test";

                  if (
                    nextBasis === "unpaid_internal_test" &&
                    lines.length > 0 &&
                    !window.confirm(
                      "Marking this as an unpaid internal test will remove the compensation terms. Continue?",
                    )
                  ) {
                    return;
                  }

                  setNotice("");
                  setCommercialBasis(nextBasis);
                  if (nextBasis === "unpaid_internal_test") {
                    setLines([]);
                  } else if (lines.length === 0) {
                    lineSequence.current += 1;
                    setLines([
                      emptyCompensationLine(`new-${lineSequence.current}`),
                    ]);
                  }
                }}
              >
                <option value="compensated">Paid compensation</option>
                <option value="unpaid_internal_test">
                  Unpaid internal test
                </option>
              </select>
            </label>
            {commercialBasis === "unpaid_internal_test" ? (
              <label>
                <span>
                  Why is this test unpaid?
                  <span
                    className="required-field-marker"
                    aria-hidden="true"
                    title="Required"
                  />
                </span>
                <textarea
                  aria-label="Unpaid internal test reason"
                  autoComplete="off"
                  maxLength={240}
                  name="unpaidReason"
                  onChange={(event) => {
                    setNotice("");
                    setUnpaidReason(event.target.value);
                  }}
                  placeholder="e.g. approved internal devnet response proof with no creator payment commitment…"
                  required
                  rows={3}
                  value={unpaidReason}
                />
              </label>
            ) : null}
            <p>
              Unpaid internal tests are explicit audit evidence. They never
              create a zero-value fee or a payment commitment.
            </p>
          </fieldset>
        )}

        {creatorPackage.commercialDetailRevision && (
          <fieldset className="package-terms__definition" disabled={saving}>
            <legend>Delivery & usage</legend>
            <div>
              <span>Package channels</span>
              {(creatorPackage.availableChannels ?? []).map((channel) => (
                <label key={channel.id} className="package-terms__channel">
                  <input
                    type="checkbox"
                    name="packageChannelIds"
                    value={channel.id}
                    checked={channelIds.includes(channel.id)}
                    onChange={(event) =>
                      setChannelIds((ids) =>
                        event.target.checked
                          ? [...ids, channel.id]
                          : ids.filter((id) => id !== channel.id),
                      )
                    }
                  />
                  <span>
                    {channel.channelType.toUpperCase()} · {channel.handle}
                  </span>
                </label>
              ))}
              {!creatorPackage.availableChannels?.length && (
                <p>
                  No creator channels recorded. Add them in the creator profile.
                </p>
              )}
            </div>
            <label>
              <span>Delivery deadline (UTC)</span>
              <input
                type="datetime-local"
                name="deliveryDeadlineUtc"
                autoComplete="off"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
              />
            </label>
            <label>
              <span>Usage rights</span>
              <textarea
                name="usageRights"
                aria-label="Usage rights"
                autoComplete="off"
                maxLength={1000}
                rows={3}
                value={usageRights}
                onChange={(event) => setUsageRights(event.target.value)}
              />
            </label>
            <label>
              <span>Exclusivity</span>
              <textarea
                name="exclusivity"
                aria-label="Exclusivity"
                autoComplete="off"
                maxLength={1000}
                rows={3}
                value={exclusivity}
                onChange={(event) => setExclusivity(event.target.value)}
              />
            </label>
            <p>
              Record the proposed terms explicitly. Blank means not specified,
              not permission or an agreement to no exclusivity.
            </p>
          </fieldset>
        )}

        {commercialBasis === "compensated" ? (
          <div className="package-terms__lines">
            {lines.length === 0 ? (
              <p className="package-terms__empty">
                No payment lines yet. This creator stays unpriced until you add
                one.
              </p>
            ) : null}
            {lines.map((line, index) => (
              <fieldset className="compensation-line" key={line.key}>
                <legend>Payment line {index + 1}</legend>
                <div className="compensation-line__grid">
                  <label>
                    <span>Asset</span>
                    <select
                      aria-label={`Asset (payment line ${index + 1})`}
                      onChange={(event) => {
                        const assetType = event.target.value as
                          "cash" | "usdc" | "token";
                        updateLine(line.key, {
                          assetType,
                          tokenDecimals:
                            assetType === "usdc" ? "6" : line.tokenDecimals,
                          unitPriceUsd:
                            assetType === "usdc" ? "1" : line.unitPriceUsd,
                        });
                      }}
                      value={line.assetType}
                    >
                      <option value="cash">Cash</option>
                      <option value="usdc">USDC</option>
                      <option value="token">Project token</option>
                    </select>
                  </label>
                  <label>
                    <span>Model</span>
                    <select
                      aria-label={`Model (payment line ${index + 1})`}
                      onChange={(event) =>
                        updateLine(line.key, {
                          model: event.target.value as "fixed" | "variable",
                        })
                      }
                      value={line.model}
                    >
                      <option value="fixed">Fixed</option>
                      <option value="variable">Variable</option>
                    </select>
                  </label>
                  <label>
                    <span>
                      Amount
                      <span
                        className="required-field-marker"
                        aria-hidden="true"
                        title="Required"
                      />
                    </span>
                    <input
                      aria-label={`Amount (payment line ${index + 1})`}
                      inputMode="decimal"
                      onChange={(event) =>
                        updateLine(line.key, { amount: event.target.value })
                      }
                      placeholder="0.00"
                      required
                      value={line.amount}
                    />
                  </label>
                  {line.assetType === "cash" ? (
                    <label>
                      <span>Currency</span>
                      <select
                        aria-label={`Currency (payment line ${index + 1})`}
                        onChange={(event) =>
                          updateLine(line.key, {
                            currencyCode: event.target.value as
                              "GBP" | "USD" | "EUR",
                          })
                        }
                        value={line.currencyCode}
                      >
                        <option value="GBP">GBP</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                      </select>
                    </label>
                  ) : (
                    <>
                      <label className="compensation-line__wide">
                        <span>
                          Token mint
                          <span
                            className="required-field-marker"
                            aria-hidden="true"
                            title="Required"
                          />
                        </span>
                        <input
                          aria-label={`Token mint (payment line ${index + 1})`}
                          maxLength={44}
                          onChange={(event) =>
                            updateLine(line.key, {
                              tokenMint: event.target.value,
                            })
                          }
                          required
                          value={line.tokenMint}
                        />
                      </label>
                      <label>
                        <span>
                          Decimals
                          <span
                            className="required-field-marker"
                            aria-hidden="true"
                            title="Required"
                          />
                        </span>
                        <input
                          aria-label={`Decimals (payment line ${index + 1})`}
                          max={18}
                          min={0}
                          onChange={(event) =>
                            updateLine(line.key, {
                              tokenDecimals: event.target.value,
                            })
                          }
                          required
                          type="number"
                          value={line.tokenDecimals}
                        />
                      </label>
                      <label>
                        <span>
                          Unit price USD
                          <span
                            className="required-field-marker"
                            aria-hidden="true"
                            title="Required"
                          />
                        </span>
                        <input
                          aria-label={`Unit price USD (payment line ${index + 1})`}
                          inputMode="decimal"
                          onChange={(event) =>
                            updateLine(line.key, {
                              unitPriceUsd: event.target.value,
                            })
                          }
                          required
                          value={line.unitPriceUsd}
                        />
                      </label>
                      <label>
                        <span>
                          Price source
                          <span
                            className="required-field-marker"
                            aria-hidden="true"
                            title="Required"
                          />
                        </span>
                        <input
                          aria-label={`Price source (payment line ${index + 1})`}
                          maxLength={160}
                          onChange={(event) =>
                            updateLine(line.key, {
                              priceSource: event.target.value,
                            })
                          }
                          required
                          value={line.priceSource}
                        />
                      </label>
                      <label>
                        <span>
                          Valuation time
                          <span
                            className="required-field-marker"
                            aria-hidden="true"
                            title="Required"
                          />
                        </span>
                        <input
                          aria-label={`Valuation time (payment line ${index + 1})`}
                          onChange={(event) =>
                            updateLine(line.key, {
                              valuedAt: event.target.value,
                            })
                          }
                          required
                          type="datetime-local"
                          value={line.valuedAt}
                        />
                      </label>
                    </>
                  )}
                  {line.model === "variable" ? (
                    <label>
                      <span>
                        Paid per
                        <span
                          className="required-field-marker"
                          aria-hidden="true"
                          title="Required"
                        />
                      </span>
                      <input
                        aria-label={`Paid per (payment line ${index + 1})`}
                        maxLength={80}
                        onChange={(event) =>
                          updateLine(line.key, {
                            variableUnit: event.target.value,
                          })
                        }
                        placeholder="Qualified wallet"
                        required
                        value={line.variableUnit}
                      />
                    </label>
                  ) : null}
                </div>
                <button
                  className="package-terms__text-action package-terms__remove"
                  onClick={() => {
                    setNotice("");
                    setLines((current) =>
                      current.filter(({ key }) => key !== line.key),
                    );
                  }}
                  type="button"
                >
                  Remove line
                </button>
              </fieldset>
            ))}
          </div>
        ) : (
          <p className="package-terms__empty">
            Unpaid internal test. No compensation or payment commitment.
          </p>
        )}
      </fieldset>
      {notice ? (
        <p className="directory-basket-notice" role="status">
          {notice}
        </p>
      ) : null}

      {readOnly ? (
        <p className={plan.small}>
          Read only. Only a campaign manager can change terms.
        </p>
      ) : (
        <footer className="package-terms__actions">
          <button
            className={plan.button}
            disabled={
              commercialBasis === "unpaid_internal_test" || lines.length >= 5
            }
            onClick={addLine}
            type="button"
          >
            Add a payment line
          </button>
          <button
            className={`${plan.button} ${plan.buttonHero}`}
            disabled={saving}
            type="submit"
          >
            {saving ? "Saving terms…" : "Save terms"}
          </button>
        </footer>
      )}
    </form>
  );
}

function CommercialApproval({
  basketId,
  canManage,
  evaluation,
  latestApproval,
  latestApprovalIsCurrent,
  onApproved,
  onResolvePackage,
  packages,
  scenario,
}: {
  basketId: string;
  canManage: boolean;
  evaluation: BasketApprovalEvaluation;
  latestApproval: CommercialPlanApprovalRecord | null;
  latestApprovalIsCurrent: boolean | null;
  onApproved: (approval: CommercialPlanApprovalRecord) => void;
  onResolvePackage: (packageId: string) => void;
  packages: BasketPackageRecord[];
  scenario: BasketRecord["scenarios"][number];
}) {
  const [reviewing, setReviewing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [approvalRequestId, setApprovalRequestId] = useState("");
  const [review, setReview] = useState<CommercialPlanReview | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");

  const reviewSpend = review
    ? calculateCommercialPlanSnapshotSpend(review.snapshot)
    : null;

  async function openReview() {
    setApprovalRequestId(crypto.randomUUID());
    setConfirmed(false);
    setReason("");
    setNotice("");
    setReview(null);
    setPreparing(true);

    try {
      const response = await fetch(
        `/api/projects/${project.id}/baskets/${basketId}/approval?scenarioId=${scenario.id}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        message?: unknown;
        review?: unknown;
      };
      const parsedReview = commercialPlanReviewSchema.safeParse(payload.review);

      if (!response.ok || !parsedReview.success) {
        setNotice(
          typeof payload.message === "string"
            ? payload.message
            : "We couldn’t prepare the review. Nothing was approved.",
        );
        return;
      }

      setReview(parsedReview.data);
      setReviewing(true);
    } catch {
      setNotice(
        "We couldn’t prepare the review. Check your connection and try again. Nothing was approved.",
      );
    } finally {
      setPreparing(false);
    }
  }

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!confirmed || !approvalRequestId || !review) {
      return;
    }

    setSubmitting(true);
    setNotice("");

    try {
      const response = await fetch(
        `/api/projects/${project.id}/baskets/${basketId}/approval`,
        {
          body: JSON.stringify({
            scenarioId: scenario.id,
            approvalRequestId,
            reason: reason.trim(),
            confirmation: "APPROVE COMMERCIAL PLAN",
            expectedSnapshotHash: review.snapshotHash,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const payload = (await response.json()) as {
        approval?: unknown;
        code?: unknown;
        message?: unknown;
      };
      const parsedApproval = commercialPlanApprovalRecordSchema.safeParse(
        payload.approval,
      );

      if (!response.ok || !parsedApproval.success) {
        setNotice(
          typeof payload.message === "string"
            ? payload.message
            : "The plan wasn’t approved.",
        );
        if (payload.code === "draft_changed") {
          setReviewing(false);
          setReview(null);
        }
        return;
      }

      onApproved(parsedApproval.data);
      setReviewing(false);
      setNotice(
        `Version ${parsedApproval.data.version} approved. The selected terms are locked; nothing has been sent or paid.`,
      );
    } catch {
      setNotice(
        "We couldn’t confirm whether the approval was saved. Reload the plan to check its status before approving again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const nextVersion = (latestApproval?.version ?? 0) + 1;
  const reviewDate = (value: string) =>
    `${value.slice(0, 16).replace("T", " ")} UTC`;

  return (
    <section
      aria-labelledby="commercial-approval-title"
      className={plan.approve}
      id="commercial-approval"
      tabIndex={-1}
    >
      <h3 id="commercial-approval-title" className={plan.visuallyHidden}>
        Review and approve scenario {scenario.code}
      </h3>
      <p className={plan.approveEffect}>
        Approving locks the selected terms into the plan. It doesn’t send
        offers, pay creators or go live.
      </p>
      <dl className={plan.approveFacts}>
        <div>
          <dt>Scenario</dt>
          <dd>
            {scenario.code} · {scenario.name}
          </dd>
        </div>
        <div>
          <dt>Creators</dt>
          <dd>{scenario.packageIds.length}</dd>
        </div>
        <div>
          <dt>Known fixed commitment</dt>
          <dd>{scenarioSpendLabel(evaluation.spend)}</dd>
        </div>
      </dl>

      {latestApproval ? (
        <div
          className={
            latestApprovalIsCurrent === false
              ? plan.inlineAlert
              : plan.inlineSuccess
          }
        >
          <p>
            <strong>
              {latestApprovalIsCurrent === false
                ? `Changed since version ${latestApproval.version}`
                : `Approved · version ${latestApproval.version}`}
            </strong>{" "}
            · scenario {latestApproval.scenarioCode} ·{" "}
            {latestApproval.scenarioName}
          </p>
          <p>{latestApproval.reason}</p>
          {latestApprovalIsCurrent === false ? (
            <p>
              This draft has changed since version {latestApproval.version} was
              approved. Review and approve again before it can be used.
            </p>
          ) : null}
          <p className={plan.small}>
            Approved {reviewDate(latestApproval.approvedAt)} · fingerprint{" "}
            {latestApproval.snapshotHash.slice(0, 12)}…
          </p>
          {latestApprovalIsCurrent === true ? (
            <a
              className={`${plan.button} ${plan.buttonHero}`}
              href={`/projects/${project.id}/campaigns?plan=${latestApproval.id}`}
            >
              Continue to campaign (version {latestApproval.version})
            </a>
          ) : null}
        </div>
      ) : null}

      {evaluation.blockers.length > 0 ? (
        <div>
          <p>
            <strong>
              {evaluation.blockers.length}{" "}
              {evaluation.blockers.length === 1 ? "thing" : "things"} to finish
              before approval
            </strong>
          </p>
          <ul className={plan.approveList}>
            {evaluation.blockers.map((blocker) => {
              const affectedPackages = blocker.packageIds
                .map((packageId) => packages.find(({ id }) => id === packageId))
                .filter(
                  (creatorPackage): creatorPackage is BasketPackageRecord =>
                    creatorPackage !== undefined,
                );
              const fallbackTarget =
                blocker.code === "outcome_missing"
                  ? "#basket-outcome"
                  : "#basket-roster";

              return (
                <li key={blocker.code}>
                  <span className={plan.dotTodo} aria-hidden="true" />
                  <span>
                    {planBlockerText(blocker)}
                    {affectedPackages.length > 0 ? (
                      <span className={plan.small}>
                        {" "}
                        ·{" "}
                        {affectedPackages
                          .map(({ creatorName }) => creatorName)
                          .join(", ")}
                      </span>
                    ) : null}
                  </span>
                  <span className={plan.approveListActions}>
                    {affectedPackages.length > 0 ? (
                      affectedPackages.map((creatorPackage) => (
                        <a
                          href={`#basket-package-${creatorPackage.id}`}
                          key={creatorPackage.id}
                          onClick={() => onResolvePackage(creatorPackage.id)}
                        >
                          Fix terms for {creatorPackage.creatorName}
                        </a>
                      ))
                    ) : (
                      <a href={fallbackTarget}>
                        {blocker.code === "outcome_missing"
                          ? "Set target"
                          : "Review candidates"}
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className={plan.small}>
          <span className={plan.dotDone} aria-hidden="true" /> Target, creators,
          deliverables, terms and currency are complete.
        </p>
      )}

      {!reviewing ? (
        <div className={plan.formFoot}>
          <button
            className={`${plan.button} ${plan.buttonHero}`}
            disabled={!evaluation.eligible || !canManage || preparing}
            onClick={openReview}
            type="button"
          >
            {!canManage
              ? "Only a campaign manager can approve"
              : evaluation.eligible
                ? preparing
                  ? "Checking the plan…"
                  : latestApproval
                    ? `Review for version ${nextVersion}`
                    : "Review the selected terms"
                : "Finish the steps first"}
          </button>
        </div>
      ) : null}

      {reviewing ? (
        <form className={plan.approveConfirm} onSubmit={approve}>
          <h4 className={plan.measureHeading}>
            Approve scenario {scenario.code} as version {nextVersion}
          </h4>
          {review && reviewSpend ? (
            <section
              aria-label="Exact commercial plan under review"
              className={plan.approveReview}
            >
              <dl className={plan.approveFacts}>
                <div>
                  <dt>Known fixed commitment</dt>
                  <dd>{scenarioSpendLabel(reviewSpend)} · agreed, not paid</dd>
                </div>
                <div>
                  <dt>Creators</dt>
                  <dd>{review.snapshot.packages.length}</dd>
                </div>
                <div>
                  <dt>Review fingerprint</dt>
                  <dd>{review.snapshotHash.slice(0, 16)}…</dd>
                </div>
              </dl>
              <ul className={plan.approveTerms}>
                {review.snapshot.packages.map((creatorPackage) => (
                  <li key={creatorPackage.id}>
                    <strong>{creatorPackage.packageLabel}</strong>
                    <span className={plan.small}>
                      {creatorPackage.deliverableSummary}
                    </span>
                    <dl>
                      {creatorPackage.compensationLines.map((line) => {
                        const display = reviewCompensationLine(line);

                        return (
                          <div key={line.id}>
                            <dt>{display.value}</dt>
                            <dd className={plan.small}>{display.evidence}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <label className={plan.field}>
            <span>
              Approval reason
              <span
                className="required-field-marker"
                aria-hidden="true"
                title="Required"
              />
            </span>
            <textarea
              maxLength={240}
              onChange={(event) => {
                setNotice("");
                setReason(event.target.value);
              }}
              placeholder="Why is this plan ready?"
              aria-required="true"
              data-required-missing={!reason.trim()}
              required
              value={reason}
            />
          </label>
          <label className={plan.approveAck}>
            <input
              checked={confirmed}
              aria-required="true"
              data-required-missing={!confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              I’ve reviewed the selected creators, deliverables and terms.
              Approving locks them as version {nextVersion}.
              <span
                className="required-field-marker"
                aria-hidden="true"
                title="Required"
              />
            </span>
          </label>
          <div className={plan.formFoot}>
            <button
              className={plan.button}
              onClick={() => setReviewing(false)}
              type="button"
            >
              Back to edit
            </button>
            <button
              className={`${plan.button} ${plan.buttonHero}`}
              disabled={!confirmed || !reason.trim() || submitting || !review}
              type="submit"
            >
              {submitting ? "Approving…" : "Approve selected terms"}
            </button>
          </div>
        </form>
      ) : null}

      {notice ? (
        <p className={plan.inlineAlert} role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

export function BasketBuilderPermission({
  theme = "light",
}: { theme?: "light" | "dark" } = {}) {
  return (
    <div className={plan.root} data-theme={theme}>
      <div className={plan.page}>
        <header className={plan.top}>
          <div className={plan.topText}>
            <p className={plan.kind}>Campaign plan</p>
            <h1 className={plan.title} id="basket-permission">
              This plan isn’t available
            </h1>
            <p className={plan.purpose}>
              You don’t have access to this project’s campaign plans. Ask a
              workspace administrator for access. No creator or terms details
              are shown.
            </p>
          </div>
        </header>
      </div>
    </div>
  );
}

export function BasketBuilder({
  basket,
  submissionSnapshot = false,
  canManage: managerAccess = true,
  timingEnabled = false,
  strategyOwnerId,
  measurementChoices,
  localCommercialEnabled = false,
  localCommercialMode = "browser",
  theme = "light",
}: {
  theme?: "light" | "dark";
  basket: BasketRecord;
  submissionSnapshot?: boolean;
  canManage?: boolean;
  timingEnabled?: boolean;
  strategyOwnerId?: string;
  measurementChoices?: BasketMeasurementChoices;
  localCommercialEnabled?: boolean;
  localCommercialMode?: LocalCommercialMode;
}) {
  const projectSlug = submissionSnapshot ? "demo" : project.id;
  const [strategyReview, setStrategyReview] = useState<StrategyReviewState>({
    blocked: true,
    revision: 0,
    key: "loading",
  });
  const [strategySaveConfirmation, setStrategySaveConfirmation] = useState<{
    id: number;
    panel: "purpose" | "measurement";
    message: string;
  }>();
  const [scenarios, setScenarios] = useState(basket.scenarios);
  const [packages, setPackages] = useState(basket.packages);
  const [objective, setObjective] = useState(basket.objective);
  const [outcomeProfile, setOutcomeProfile] = useState(basket.outcomeProfile);
  const [latestApproval, setLatestApproval] = useState(basket.latestApproval);
  const canManage = managerAccess && !latestApproval;
  const [latestApprovalIsCurrent, setLatestApprovalIsCurrent] = useState(
    basket.latestApprovalIsCurrent,
  );
  const [activeScenarioId, setActiveScenarioId] = useState(
    basket.scenarios[0]?.id ?? "",
  );
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState("");
  const [strategySection, setStrategySection] = useState<
    "purpose" | "measurement"
  >("purpose");
  const [timingStatus, setTimingStatus] = useState<TimingPanelStatus | null>(
    null,
  );
  const [reviewSlot, setReviewSlot] = useState<HTMLElement | null>(null);
  const guided = timingEnabled && !!strategyOwnerId;
  const activeScenario =
    scenarios.find(({ id }) => id === activeScenarioId) ?? scenarios[0];

  const scenarioSummaries = useMemo(
    () =>
      new Map(
        scenarios.map((scenario) => [
          scenario.id,
          calculateScenarioSpend(packages, scenario.packageIds),
        ]),
      ),
    [packages, scenarios],
  );
  const scenarioForecasts = useMemo(
    () =>
      new Map(
        scenarios.map((scenario) => [
          scenario.id,
          calculateScenarioForecast(packages, scenario.packageIds),
        ]),
      ),
    [packages, scenarios],
  );
  const draftBasket = useMemo<BasketRecord>(
    () => ({
      ...basket,
      latestApproval,
      latestApprovalIsCurrent,
      objective,
      outcomeProfile,
      packages,
      scenarios,
    }),
    [
      basket,
      latestApproval,
      latestApprovalIsCurrent,
      objective,
      outcomeProfile,
      packages,
      scenarios,
    ],
  );
  const approvalEvaluation = useMemo(
    () =>
      activeScenario
        ? evaluateBasketScenarioApproval(draftBasket, activeScenario.id)
        : null,
    [activeScenario, draftBasket],
  );

  const blockersByPackage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const blocker of approvalEvaluation?.blockers ?? [])
      for (const packageId of blocker.packageIds)
        map.set(packageId, [
          ...(map.get(packageId) ?? []),
          planBlockerText(blocker),
        ]);
    return map;
  }, [approvalEvaluation]);
  const activeSummary = activeScenario
    ? scenarioSummaries.get(activeScenario.id)
    : undefined;
  const computedForecast = activeScenario
    ? scenarioForecasts.get(activeScenario.id)
    : undefined;
  const activeForecast =
    submissionSnapshot && computedForecast
      ? {
          ...computedForecast,
          qualifiedWallets: { p25: 280, base: 380, p75: 480 },
        }
      : computedForecast;
  const largestPackage = activeSummary?.largestPackageId
    ? packages.find(({ id }) => id === activeSummary.largestPackageId)
    : undefined;

  async function setPackageIncluded(packageId: string, included: boolean) {
    if (!activeScenario) {
      return;
    }

    const changeKey = `${activeScenario.id}:${packageId}`;
    setNotice("");
    setPendingKeys((current) => new Set(current).add(changeKey));
    setScenarios((current) =>
      withScenarioPackage(current, activeScenario.id, packageId, included),
    );

    try {
      const response = await fetch(
        `/api/projects/${projectSlug}/baskets/${basket.id}/assignments`,
        {
          body: JSON.stringify({
            included,
            packageId,
            scenarioId: activeScenario.id,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const payload = (await response.json()) as { message?: unknown };

      if (!response.ok) {
        setScenarios((current) =>
          withScenarioPackage(current, activeScenario.id, packageId, !included),
        );
        setNotice(
          typeof payload.message === "string"
            ? payload.message
            : "The scenario could not be updated.",
        );
      } else if (latestApproval) {
        setLatestApprovalIsCurrent(false);
      }
    } catch {
      setScenarios((current) =>
        withScenarioPackage(current, activeScenario.id, packageId, !included),
      );
      setNotice(
        "The scenario could not be updated. Check your connection and try again.",
      );
    } finally {
      setPendingKeys((current) => {
        const next = new Set(current);
        next.delete(changeKey);
        return next;
      });
    }
  }

  if (!activeScenario) {
    return (
      <div className={plan.root} data-theme={theme}>
        <div className={plan.page}>
          <header className={plan.top}>
            <div className={plan.topText}>
              <p className={plan.kind}>Campaign plan</p>
              <h1 className={plan.title} id="basket-empty-title">
                {basket.name}
              </h1>
              <p className={plan.purpose}>
                This plan has no scenarios, so there’s nothing to set up yet.
                Start a new plan from your creator directory.
              </p>
            </div>
          </header>
        </div>
      </div>
    );
  }

  // ---- Step statuses (from saved state only) --------------------------------
  const identityChecking = guided && !strategyReview.identityConfirmed;
  const summary = strategyReview.summary;
  const strategyUnsaved =
    !!summary && (summary.dirty || summary.recovering || summary.needsReview);
  const choices =
    measurementChoices?.kind === "ready" ? measurementChoices.options : [];
  const savedChoice = choices.find(
    ({ id }) => id === summary?.measurementVersionId,
  );
  const includedPackages = packages.filter(({ id }) =>
    activeScenario.packageIds.includes(id),
  );
  const packagesNeedingTerms = includedPackages.filter((item) =>
    blockersByPackage.has(item.id),
  );
  const rosterEmpty =
    approvalEvaluation?.blockers.some(({ code }) => code === "roster_empty") ??
    includedPackages.length === 0;
  const targetRuleConflict =
    guided &&
    !!outcomeProfile &&
    !!summary?.measurementVersionId &&
    (outcomeProfile.metric === "verified_revenue" ||
      (!!summary.primaryOutcome &&
        summary.primaryOutcome !== outcomeProfile.metric));
  const outcomeDone = !!outcomeProfile && !!objective && !targetRuleConflict;
  const targetSummary = outcomeProfile
    ? `${outcomeProfile.metric === "qualified_wallets" ? outcomeProfile.baselineUnits : baseUnitsToDecimal(outcomeProfile.baselineUnits, 2)} → ${outcomeValue(
        outcomeProfile.targetUnits,
        outcomeProfile.metric,
        outcomeProfile.currencyCode,
      ).toLowerCase()}`
    : "Set a baseline and the number you’re aiming for";
  const missingPurpose = summary?.purposeGaps ?? [];

  const steps: (PlanStep & { panel: PlanPanelId; packageId?: string })[] = [];
  if (guided) {
    steps.push({
      id: "purpose",
      panel: "purpose",
      title: "Goal and audience",
      status:
        identityChecking || !summary
          ? "checking"
          : strategyUnsaved
            ? "unsaved"
            : missingPurpose.length === 0
              ? "done"
              : "todo",
      summary: identityChecking
        ? "Confirming your session"
        : !summary
          ? "Loading the saved strategy"
          : strategyUnsaved
            ? "Save the strategy to keep your changes"
            : summary && missingPurpose.length === 0
              ? `${summary.goal} · ${summary.audience}`
              : `Still needed: ${
                  missingPurpose.length > 1
                    ? `${missingPurpose.slice(0, -1).join(", ")} and ${missingPurpose.at(-1)}`
                    : missingPurpose[0]
                }`,
      actionLabel:
        summary && missingPurpose.length === 0 && !strategyUnsaved
          ? canManage
            ? "Edit"
            : "View"
          : "Finish",
      actionDisabled: identityChecking,
      onAction: () => undefined,
    });
    const ruleDone =
      !!savedChoice?.supported &&
      !summary?.measurementMissing &&
      !strategyUnsaved;
    steps.push({
      id: "measurement",
      panel: "measurement",
      title: "What counts as a result",
      status:
        identityChecking || !summary
          ? "checking"
          : strategyUnsaved
            ? "unsaved"
            : ruleDone
              ? "done"
              : measurementChoices?.kind === "unavailable"
                ? "unavailable"
                : "todo",
      summary: identityChecking
        ? "Confirming your session"
        : !summary
          ? "Loading the saved strategy"
          : strategyUnsaved
            ? "Save the strategy to keep your rule choice"
            : ruleDone
              ? savedChoice.description
              : summary?.measurementVersionId
                ? "The saved rule isn’t available or supported. Choose a current rule"
                : "Choose the rule that decides which wallets count",
      detail: savedChoice
        ? `Rule: ${savedChoice.name} · version ${savedChoice.version} · shared`
        : undefined,
      actionLabel: ruleDone ? (canManage ? "Change" : "View") : "Choose rule",
      actionDisabled: identityChecking,
      onAction: () => undefined,
    });
  }
  steps.push({
    id: "target",
    panel: "target",
    title: "Target",
    status: identityChecking ? "checking" : outcomeDone ? "done" : "todo",
    summary: identityChecking
      ? "Confirming your session"
      : targetRuleConflict
        ? "The target must match the selected rule. This rule counts qualified wallets, not revenue."
        : targetSummary,
    actionLabel: outcomeDone ? (canManage ? "Edit" : "View") : "Set target",
    actionDisabled: identityChecking,
    onAction: () => undefined,
  });
  if (timingEnabled) {
    const dates = timingStatus;
    const datesDone =
      !!dates &&
      dates.hasSavedTiming &&
      !dates.dirty &&
      !dates.needsReview &&
      !dates.recovering &&
      dates.phase === "ready";
    steps.push({
      id: "dates",
      panel: "dates",
      title: "Dates",
      status:
        !dates || dates.phase === "loading" || dates.phase === "saving"
          ? "checking"
          : dates.dirty || dates.recovering || dates.needsReview
            ? "unsaved"
            : datesDone
              ? "done"
              : "todo",
      summary:
        !dates || dates.phase === "loading"
          ? "Loading saved dates"
          : dates.phase === "saving"
            ? "Saving dates…"
            : dates.recovering
              ? "Unsaved dates from this visit"
              : dates.errorCount > 0
                ? "Fix the highlighted dates"
                : dates.dirty
                  ? "Save your date changes"
                  : datesDone
                    ? "Campaign and measurement dates saved"
                    : "When creators post and how long results are counted",
      actionLabel: datesDone ? (canManage ? "Edit" : "View") : "Add dates",
      onAction: () => undefined,
    });
  }
  const firstNeedingTerms = packagesNeedingTerms[0];
  steps.push({
    id: "terms",
    panel: "terms",
    packageId: firstNeedingTerms?.id,
    title: "Creator terms",
    status: rosterEmpty
      ? "todo"
      : packagesNeedingTerms.length === 0
        ? "done"
        : "todo",
    summary: rosterEmpty
      ? "Include at least one creator in this scenario"
      : packagesNeedingTerms.length === 0
        ? `${includedPackages.length} of ${includedPackages.length} ready`
        : `${includedPackages.length - packagesNeedingTerms.length} of ${includedPackages.length} ready · ${firstNeedingTerms?.creatorName} ${
            firstNeedingTerms?.compensationLines.length
              ? "needs a fix"
              : "has no terms yet"
          }`,
    actionLabel:
      packagesNeedingTerms.length === 0 && !rosterEmpty
        ? canManage
          ? "Edit"
          : "View"
        : rosterEmpty
          ? "Add creators"
          : "Finish terms",
    onAction: () => undefined,
  });
  // Load failures and checks are not "to do": say so, and keep the button a
  // plain way to open the step (where the editor offers its own retry).
  const strategyFailed =
    guided && !identityChecking && strategyReview.load === "failed";
  for (const step of steps) {
    if (strategyFailed && (step.id === "purpose" || step.id === "measurement"))
      Object.assign(step, {
        status: "unavailable",
        summary: "We couldn’t load the saved strategy. Open to try again.",
        detail: undefined,
      });
    if (step.id === "dates" && timingStatus?.phase === "unconfirmed")
      Object.assign(step, {
        status: "unavailable",
        summary: timingStatus.hasSavedTiming
          ? "We couldn’t confirm the saved dates. Open to check them."
          : "We couldn’t load the saved dates. Open to try again.",
      });
    if (step.id === "dates" && timingStatus?.phase === "missing")
      Object.assign(step, {
        status: "unavailable",
        summary: "Save Goal and audience first, then add dates.",
      });
    if (step.status === "checking" || step.status === "unavailable")
      step.actionLabel = "Open";
  }
  const unfinished = steps.filter(({ status }) => status !== "done");
  const actionable = unfinished.filter(
    ({ status }) => status === "todo" || status === "unsaved",
  );

  // ---- Approval state -------------------------------------------------------
  const approvedCurrent = !!latestApproval && latestApprovalIsCurrent === true;
  const approvedHistorical =
    !!latestApproval && latestApprovalIsCurrent === false;
  const statusLabel = approvedCurrent
    ? `Approved · terms locked (version ${latestApproval.version})`
    : approvedHistorical
      ? `Changed since approved version ${latestApproval.version}`
      : "Draft · not approved";
  const continueHref = latestApproval
    ? `/projects/${projectSlug}/campaigns?plan=${latestApproval.id}`
    : undefined;
  const addHref = guided
    ? `/projects/${projectSlug}/kols?basket=${basket.id}`
    : `/projects/${projectSlug}/kols`;
  const openStep = (
    open: OpenPlanPanel,
    step: { panel: PlanPanelId; packageId?: string },
  ) => {
    if (step.panel === "terms" && rosterEmpty) {
      window.location.assign(addHref);
      return;
    }
    if (step.panel === "terms")
      setEditingPackageId(
        step.packageId ?? editingPackageId ?? packages[0]?.id ?? null,
      );
    open(
      step.panel,
      step.panel === "terms" && step.packageId
        ? `#basket-package-${step.packageId}`
        : "",
    );
  };

  const purposeText = approvedCurrent
    ? "This plan is approved. Next, continue to its campaign: that’s where you brief creators, set up tracking links and follow results."
    : `Decide which creators you’ll work with, what you’ll pay them${
        guided ? " and what counts as a result" : ""
      }. Finish the ${steps.length} steps, then review and approve. Approval locks the selected terms. It does not book, send or pay.`;

  const editingPackage =
    packages.find(({ id }) => id === editingPackageId) ??
    firstNeedingTerms ??
    null;

  const stepEyebrow = (panel: PlanPanelId) => {
    const index = steps.findIndex((step) => step.panel === panel);
    const displayName = basket.name.replace(
      /( — revised draft){2,}$/,
      " — revised draft",
    );
    return index < 0
      ? displayName
      : `Step ${index + 1} of ${steps.length} · ${displayName}`;
  };
  const strategySaveAction = (label: string) =>
    canManage && !latestApproval ? (
      <>
        <button
          type="submit"
          form={`basket-strategy-form-${basket.id}`}
          className={`${plan.button} ${plan.buttonHero}`}
          disabled={
            !strategyReview.canSave || !strategyReview.identityConfirmed
          }
          aria-busy={strategyReview.saving}
        >
          {strategyReview.saving ? "Saving…" : label}
        </button>
        <p className={plan.saveHint}>
          Saves this rule choice and any goal or audience edits to the draft.
          Approval comes later.
        </p>
      </>
    ) : undefined;
  const panels: PlanPanel[] = [];
  if (guided) {
    panels.push(
      {
        id: "purpose",
        alsoFor: ["measurement"],
        eyebrow: stepEyebrow("purpose"),
        title: "Goal and audience",
        footerAction: strategySaveAction("Save changes"),
        description:
          "Who you’re reaching and why. Saved together with What counts as a result.",
        content: (
          <BasketStrategyEditor
            key={`${basket.id}:${strategyOwnerId}:${canManage}`}
            theme={theme}
            projectId={projectSlug}
            basketId={basket.id}
            ownerId={strategyOwnerId}
            canManage={canManage && !latestApproval}
            allowPrivateLinkTest={
              localCommercialEnabled && localCommercialMode === "devnet"
            }
            onReviewState={setStrategyReview}
            measurementChoices={measurementChoices}
            section={strategySection}
            footerSave
            onSaved={(section) => {
              if (section !== "purpose" && section !== "measurement") return;
              setStrategySaveConfirmation((previous) => ({
                id: (previous?.id ?? 0) + 1,
                panel: section,
                message:
                  section === "measurement" ? "Choice saved" : "Changes saved",
              }));
            }}
          />
        ),
      },
      {
        id: "measurement",
        eyebrow: stepEyebrow("measurement"),
        title: "What counts as a result",
        footerAction: strategySaveAction("Save choice"),
        description:
          "You’re setting up results in a draft campaign plan. Choose a rule below; your approved campaign stays unchanged.",
        content: null,
      },
    );
  }
  panels.push({
    id: "target",
    eyebrow: stepEyebrow("target"),
    title: "Target",
    description:
      "A baseline and the number you’re aiming for. It’s a goal, not a predicted result.",
    content: identityChecking ? (
      <section id="basket-outcome" tabIndex={-1} role="status">
        Confirming your account before showing the numerical target. If you have
        changed accounts, reload this page.
      </section>
    ) : (
      <OutcomeSetup
        basketId={basket.id}
        initialObjective={objective}
        initialProfile={outcomeProfile}
        guided={guided}
        readOnly={!canManage}
        savedGoal={
          guided && canManage && !strategyReview.blocked
            ? strategyReview.savedGoal
            : null
        }
        onSaved={(nextObjective, nextProfile) => {
          setObjective(nextObjective);
          setOutcomeProfile(nextProfile);
          if (latestApproval) {
            setLatestApprovalIsCurrent(false);
          }
        }}
      />
    ),
  });
  if (timingEnabled)
    panels.push({
      id: "dates",
      eyebrow: stepEyebrow("dates"),
      title: "Dates",
      description:
        "When creators post, and how long results are counted. Times are UTC.",
      content: (
        <BasketTimingPanel
          localCommercialEnabled={localCommercialEnabled}
          localCommercialMode={localCommercialMode}
          key={`${basket.id}:${canManage}`}
          basketId={basket.id}
          projectId={projectSlug}
          canManage={canManage && !latestApproval}
          scenarioId={activeScenario.id}
          reviewBlocked={!!strategyOwnerId && strategyReview.blocked}
          minimumReviewRevision={strategyReview.revision}
          reviewKey={JSON.stringify([
            draftBasket,
            Array.from(pendingKeys),
            strategyReview.key,
          ])}
          onStatusChange={setTimingStatus}
          reviewTarget={reviewSlot}
        />
      ),
    });
  panels.push({
    id: "terms",
    eyebrow: stepEyebrow("terms"),
    title: editingPackage
      ? `Terms for ${editingPackage.creatorName}`
      : "Creator terms",
    description: !canManage
      ? approvedCurrent
        ? "Approved terms · read only. Start a new plan to change them."
        : approvedHistorical
          ? "Saved terms · read only. This plan differs from its previous approval."
          : "Read-only access to saved deliverables and compensation."
      : "What each creator delivers and what you’ll pay. Agreed drafts, not payments.",
    content: (
      <div className={plan.termsPanel}>
        {packagesNeedingTerms.length > 1 ? (
          <nav
            aria-label="Creators who still need terms"
            className={plan.termsSwitch}
          >
            <p className={plan.small}>Still needs terms:</p>
            {packagesNeedingTerms.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${plan.button} ${item.id === editingPackage?.id ? plan.buttonCurrent : plan.buttonAttention}`}
                aria-pressed={item.id === editingPackage?.id}
                onClick={() => setEditingPackageId(item.id)}
              >
                {item.creatorName}
              </button>
            ))}
          </nav>
        ) : null}
        {editingPackage ? (
          <>
            {blockersByPackage.get(editingPackage.id)?.length ? (
              <p className={plan.inlineAlert} role="status">
                {blockersByPackage.get(editingPackage.id)!.join(" ")}
              </p>
            ) : null}
            <PackageTermsEditor
              basketId={basket.id}
              creatorPackage={editingPackage}
              key={editingPackage.id}
              readOnly={!canManage}
              onSaved={(savedPackage) => {
                setPackages((current) =>
                  current.map((currentPackage) =>
                    currentPackage.id === savedPackage.id
                      ? savedPackage
                      : currentPackage,
                  ),
                );
                if (latestApproval) {
                  setLatestApprovalIsCurrent(false);
                }
              }}
            />
          </>
        ) : (
          <p className={plan.small}>
            Choose a creator’s terms button in the candidates list.
          </p>
        )}
      </div>
    ),
  });
  panels.push({
    id: "review",
    eyebrow: basket.name,
    title: approvedCurrent
      ? "Approved plan"
      : timingEnabled && !localCommercialEnabled
        ? "Review saved plan"
        : "Review and approve",
    // As at baseline: with dates enabled, the saved-plan review (portalled
    // from the dates panel) is the only approval path.
    description: timingEnabled
      ? localCommercialEnabled
        ? "Check your saved plan before confirming approval. Unsaved edits aren’t included."
        : "Check your saved goals, creator terms and dates. This preview cannot approve or launch a campaign."
      : "Check the plan, then approve its terms as a locked version.",
    content: timingEnabled ? (
      <div ref={setReviewSlot} />
    ) : approvalEvaluation ? (
      <CommercialApproval
        basketId={basket.id}
        canManage={canManage}
        evaluation={approvalEvaluation}
        latestApproval={latestApproval}
        latestApprovalIsCurrent={latestApprovalIsCurrent}
        onApproved={(approval) => {
          setLatestApproval(approval);
          setLatestApprovalIsCurrent(true);
        }}
        onResolvePackage={setEditingPackageId}
        packages={packages}
        scenario={activeScenario}
      />
    ) : null,
  });
  panels.push({
    id: "compare",
    eyebrow: basket.name,
    title: "Compare scenarios",
    description:
      "Each scenario is a different mix of the same candidates. You approve one.",
    content: (
      <ScenarioComparison
        scenarios={scenarios}
        activeId={activeScenario.id}
        summaries={scenarioSummaries}
        forecasts={scenarioForecasts}
        packages={packages}
        onPick={setActiveScenarioId}
      />
    ),
  });

  if (submissionSnapshot) {
    const contextSteps = [
      {
        id: "purpose" as const,
        title: "Goal and audience",
        summary: "Acquire qualified product users · Solana consumers",
        detail:
          "A three-creator education campaign for consumers trying a new Solana application.",
      },
      {
        id: "measurement" as const,
        title: "What counts as a result",
        summary:
          "First qualifying action after optional wallet proof and consent",
        detail:
          "Count each consenting wallet once after its first qualifying finalized action within seven days of an eligible creator visit. All proof and outcome records here are synthetic; no purchase or revenue is claimed.",
      },
      {
        id: "dates" as const,
        title: "Dates",
        summary: "28 September–11 October · 14 days",
        detail:
          "Creator activity and measurement run from 28 September 00:00 UTC to 12 October 00:00 UTC (exclusive). Synthetic activity is distributed across all 14 days.",
      },
    ];
    for (const item of contextSteps) {
      steps.push({
        id: item.id,
        panel: item.id,
        title: item.title,
        status: "done",
        summary: item.summary,
        actionLabel: "View",
        onAction: () => undefined,
      });
      panels.push({
        id: item.id,
        eyebrow: "Synthetic campaign plan",
        title: item.title,
        description: "Illustrative saved plan · read-only",
        content: (
          <section className={plan.card}>
            <h3>{item.summary}</h3>
            <p>{item.detail}</p>
          </section>
        ),
      });
    }
    const order = ["purpose", "measurement", "target", "dates", "terms"];
    steps.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    for (const panel of panels) {
      const index = order.indexOf(panel.id);
      if (index >= 0)
        panel.eyebrow = `Step ${index + 1} of 5 · Synthetic campaign plan`;
    }
  }
  return (
    <BasketWorkspace
      saveConfirmation={strategySaveConfirmation}
      readOnly={!canManage}
      footerAction={
        managerAccess && latestApproval && !identityChecking ? (
          <PlanRevisionAction
            key={`${basket.id}:${latestApproval.id}`}
            projectId={projectSlug}
            basketId={basket.id}
            sourcePlanId={latestApproval.id}
            theme={theme}
          />
        ) : undefined
      }
      theme={theme}
      name={basket.name}
      statusLabel={
        submissionSnapshot ? "Synthetic approved plan · read-only" : statusLabel
      }
      statusTone={
        approvedCurrent
          ? "approved"
          : approvedHistorical
            ? "historical"
            : "draft"
      }
      purpose={purposeText}
      backHref={`/projects/${projectSlug}/baskets`}
      heroLabel={
        approvedCurrent
          ? "Continue to campaign"
          : canManage
            ? timingEnabled && !localCommercialEnabled
              ? "Review saved plan"
              : "Review and approve"
            : undefined
      }
      heroHref={approvedCurrent ? continueHref : undefined}
      onHero={(open) => {
        const next = actionable[0] ?? unfinished[0];
        if (next) openStep(open, next);
        else open("review");
      }}
      heroNote={(open) =>
        approvedCurrent ? (
          <p className={plan.heroNoteText}>
            Approved {latestApproval.approvedAt.slice(0, 10)}. Approving didn’t
            send offers, pay anyone or put anything live.
          </p>
        ) : !canManage ? (
          <p className={plan.heroNoteText}>
            {latestApproval
              ? "This plan has an approved version and is read-only."
              : "Only a campaign manager can review and approve this plan."}
          </p>
        ) : unfinished.length > 0 && actionable.length === 0 ? (
          <p className={plan.heroNoteText}>
            <span className={plan.dotUnavailable} aria-hidden="true" />{" "}
            {unfinished.some(({ status }) => status === "unavailable")
              ? "Some steps couldn’t be loaded. Open them to try again."
              : "Checking saved steps…"}
          </p>
        ) : unfinished.length > 0 ? (
          <div className={plan.stepsLeft}>
            <span className={plan.dotTodo} aria-hidden="true" />
            <strong>
              {unfinished.length} {unfinished.length === 1 ? "step" : "steps"}{" "}
              left:
            </strong>
            {actionable.map((step, index) => (
              <Fragment key={step.id}>
                {index > 0 ? (
                  <span className={plan.stepsSep} aria-hidden="true">
                    ·
                  </span>
                ) : null}
                <button
                  type="button"
                  className={plan.linkButton}
                  onClick={() => openStep(open, step)}
                >
                  {step.id === "terms" && firstNeedingTerms && canManage
                    ? `Finish ${firstNeedingTerms.creatorName}’s terms`
                    : step.actionLabel === "Edit" ||
                        step.actionLabel === "Change"
                      ? step.title
                      : step.actionLabel}
                </button>
              </Fragment>
            ))}
          </div>
        ) : (
          <p className={plan.heroNoteText}>
            <span className={plan.dotDone} aria-hidden="true" /> Ready to review
          </p>
        )
      }
      panels={panels}
      onOpenPanel={(panel, hash) => {
        if (panel === "purpose" || panel === "measurement")
          setStrategySection(panel);
        if (panel === "terms" && hash.startsWith("#basket-package-"))
          setEditingPackageId(hash.replace("#basket-package-", ""));
        if (panel === "terms" && hash.startsWith("#package-terms-"))
          setEditingPackageId(hash.replace("#package-terms-", ""));
      }}
    >
      {(open, openPanel) => (
        <>
          <div className={plan.scenarioRow} role="group" aria-label="Scenario">
            <span className={plan.scenarioLabel} id="scenario-label">
              Scenario
            </span>
            <div className={plan.segmented}>
              {(submissionSnapshot ? scenarios.slice(0, 1) : scenarios).map(
                (scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    aria-pressed={scenario.id === activeScenario.id}
                    className={plan.segment}
                    onClick={() => setActiveScenarioId(scenario.id)}
                  >
                    {scenario.code} · {scenario.name}
                  </button>
                ),
              )}
            </div>
            {!submissionSnapshot && (
              <>
                <button
                  type="button"
                  className={plan.button}
                  onClick={() => open("compare")}
                >
                  Compare
                </button>
                <p className={plan.small}>
                  Each scenario is a different mix of the same candidates. You
                  approve one.
                </p>
              </>
            )}
          </div>
          <div className={plan.grid}>
            <PlanStepsCard
              steps={steps.map((step) => ({
                ...step,
                onAction: () => openStep(open, step),
              }))}
              title={approvedCurrent ? "Plan details" : undefined}
              locked={approvedCurrent}
              currentId={
                steps.find(({ panel }) => panel === openPanel)?.id ?? null
              }
              intro={
                approvedCurrent
                  ? "These are the approved details and are read-only. Start a new plan to change creator terms."
                  : "Do them in any order. Each step shows whether its saved version is complete."
              }
              footer={
                approvedCurrent
                  ? undefined
                  : timingEnabled && !localCommercialEnabled
                    ? "Then: Review your saved plan. Approval is unavailable in this preview."
                    : "Then: Review and approve. You check the saved plan and approve the selected terms in one place."
              }
            />
            <div className={plan.mainColumn}>
              <PlanForecast
                forecast={activeForecast}
                assumptionLabel={
                  submissionSnapshot
                    ? "Synthetic planning assumption · illustrative range, not a model prediction"
                    : undefined
                }
                spend={activeSummary}
                packages={packages}
                packageIds={activeScenario.packageIds}
                targetWallets={
                  outcomeProfile?.metric === "qualified_wallets"
                    ? outcomeProfile.targetUnits
                    : null
                }
                largestCreatorName={largestPackage?.creatorName ?? null}
              />
              <PlanCandidates
                readOnlySnapshot={submissionSnapshot}
                packages={packages}
                scenario={activeScenario}
                pendingKeys={pendingKeys}
                blockersByPackage={blockersByPackage}
                canManage={canManage}
                addHref={addHref}
                notice={notice}
                onToggle={(packageId, included) =>
                  void setPackageIncluded(packageId, included)
                }
                onOpenTerms={(packageId) => {
                  setEditingPackageId(packageId);
                  open("terms", `#basket-package-${packageId}`);
                }}
              />
            </div>
          </div>
        </>
      )}
    </BasketWorkspace>
  );
}

function ScenarioComparison({
  scenarios,
  activeId,
  summaries,
  forecasts,
  packages,
  onPick,
}: {
  scenarios: BasketRecord["scenarios"];
  activeId: string;
  summaries: Map<string, ScenarioSpendSummary>;
  forecasts: Map<string, ScenarioForecastSummary>;
  packages: BasketPackageRecord[];
  onPick: (id: string) => void;
}) {
  return (
    <div className={plan.compare}>
      <table className={plan.table}>
        <caption className={plan.visuallyHidden}>
          Scenarios side by side
        </caption>
        <thead>
          <tr>
            <th scope="col">Scenario</th>
            <th scope="col">Creators</th>
            <th scope="col">Known fixed commitment</th>
            <th scope="col">Expected wallets (forecast)</th>
            <th scope="col">
              <span className={plan.visuallyHidden}>Choose</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((scenario) => {
            const spend = summaries.get(scenario.id);
            const forecast = forecasts.get(scenario.id);
            const cost = costPerQualifiedWallet({
              spend,
              forecast,
              packages,
              packageIds: scenario.packageIds,
            });
            return (
              <tr key={scenario.id}>
                <th scope="row">
                  {scenario.code} · {scenario.name}
                  {scenario.id === activeId ? (
                    <span className={plan.small}> · showing</span>
                  ) : null}
                </th>
                <td>{scenario.packageIds.length}</td>
                <td>
                  {spend ? scenarioSpendLabel(spend) : "Not available yet"}
                </td>
                <td>
                  {forecast &&
                  (forecast.status === "ready" || forecast.status === "partial")
                    ? `${forecast.qualifiedWallets.base} likely · ${forecast.qualifiedWallets.p25}–${forecast.qualifiedWallets.p75}${forecast.status === "partial" ? " · partial" : ""}`
                    : "Not available yet"}
                  {cost.kind === "available" ? (
                    <span className={plan.small}>
                      {" "}
                      · {formatWholeAmount(cost.currencyCode, cost.base)} per
                      wallet (target until results)
                    </span>
                  ) : null}
                </td>
                <td>
                  <button
                    type="button"
                    className={plan.button}
                    aria-pressed={scenario.id === activeId}
                    onClick={() => onPick(scenario.id)}
                  >
                    {scenario.id === activeId
                      ? "Showing"
                      : `Show ${scenario.code}`}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <details className={plan.advanced}>
        <summary>How the wallet forecast works</summary>
        <p>
          Planning model v1, a forecast and not an observed result. Audience
          evidence feeds a conservative overlap and response model: 15% overlap
          after the first creator, reach 12–30% and wallet response 0.05–0.20%.
          Ranges are P25 / base / P75.
        </p>
      </details>
    </div>
  );
}
