import type { BasketMeasurementChoice } from "@/lib/baskets/measurement-choices";

import styles from "./campaign-plan.module.css";

/*
 * BSK-08 / UI-03 · "What counts as a result" (journey boards 02b, 04c).
 * Presentation of the existing project rule versions. Choosing a rule only
 * changes this plan's strategy draft, which saves through the existing
 * strategy save. Shared, versioned rules change only on Settings › Success
 * rules, behind its own review.
 *
 * Wording comes from the selected rule itself. The fixed facts below are only
 * shown for a supported choice, because "supported" already requires a signed
 * consenting wallet, the last eligible creator touch within seven days and no
 * revenue mapping (see lib/baskets/measurement-choices.ts).
 */

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function PlanMeasurementPanel({
  kind,
  choices,
  selectedId,
  savedId,
  disabled,
  canManage,
  onChoose,
  settingsHref,
}: {
  kind: "ready" | "unavailable";
  choices: BasketMeasurementChoice[];
  selectedId: string | null;
  savedId: string | null;
  disabled: boolean;
  canManage: boolean;
  onChoose: (choice: BasketMeasurementChoice | null) => void;
  settingsHref: string;
}) {
  const selected = choices.find(({ id }) => id === selectedId) ?? null;
  const missingSelection = !!selectedId && !selected;
  const anySupported = choices.some(({ supported }) => supported);

  return (
    <section className={styles.measure} aria-labelledby="basket-measurement">
      <h3
        id="basket-measurement"
        tabIndex={-1}
        className={styles.visuallyHidden}
      >
        What counts as a result
      </h3>
      <p className={styles.small}>
        Choose one rule, then save. This choice applies only to this draft.
      </p>
      {missingSelection && (
        <p role="alert">
          The rule saved on this plan isn’t available right now. It’s kept on
          the plan. Choose a current rule before review.
        </p>
      )}
      {selected && !selected.supported && (
        <p className={styles.warnText} role="alert">
          This rule isn’t supported for plans yet. Choose a supported rule
          before review.
        </p>
      )}
      <fieldset
        className={styles.choiceList}
        disabled={disabled}
        role="radiogroup"
        aria-required="true"
        aria-labelledby="plan-rule-choice-label"
        data-required-missing={!selected?.supported}
      >
        <legend id="plan-rule-choice-label" className={styles.choiceLegend}>
          Rules in this project
          <span
            className="required-field-marker"
            aria-hidden="true"
            title="Required"
          />
        </legend>
        {kind === "unavailable" ? (
          <p role="alert" className={styles.small}>
            We couldn’t load this project’s rules. Your plan’s saved choice is
            kept. Reload the page to try again.
          </p>
        ) : choices.length === 0 ? (
          <p className={styles.small}>
            {canManage
              ? "This project has no success rule yet. Create the first version, then return here to choose it."
              : "This project has no success rule yet. Ask a campaign manager to create one."}
          </p>
        ) : null}
        {missingSelection ? (
          <label className={`${styles.choice} ${styles.choiceSelected}`}>
            <input
              type="radio"
              name="measurement-definition"
              value={selectedId ?? ""}
              checked
              disabled
              readOnly
            />
            <span className={styles.choiceText}>
              <strong>Saved rule unavailable</strong>
              <span className={styles.small}>
                Kept on this plan until you choose another.
              </span>
            </span>
          </label>
        ) : null}
        {choices.map((choice) => (
          <label
            key={choice.id}
            className={`${styles.choice} ${choice.id === selectedId ? styles.choiceSelected : ""} ${
              choice.supported ? "" : styles.choiceOff
            }`}
          >
            <input
              type="radio"
              name="measurement-definition"
              value={choice.id}
              checked={choice.id === selectedId}
              disabled={!choice.supported || kind !== "ready" || !anySupported}
              onChange={() => onChoose(choice)}
            />
            <span className={styles.choiceText}>
              <span className={styles.choiceName}>
                <strong>{choice.label ?? choice.name}</strong>
                <span className={styles.small}>version {choice.version}</span>
                {choice.id === savedId ? (
                  <span className={styles.pillDone}>Saved on this plan</span>
                ) : !choice.supported ? (
                  <span className={styles.pillUnavailable}>
                    Not supported yet
                  </span>
                ) : null}
              </span>
              <span className={styles.small}>
                {choice.summary ?? choice.description}
              </span>
              <span className={styles.small}>
                From {dateLabel(choice.effectiveFrom)}
                {choice.effectiveUntil
                  ? ` until ${dateLabel(choice.effectiveUntil)}`
                  : " · no end date"}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {selected?.supported && (
        <p className={styles.small} aria-live="polite">
          Only consenting, verified wallets count. Credit goes to the last
          eligible creator visit within 7 days. Revenue is not counted.
        </p>
      )}
      {!selectedId && (
        <p className={styles.small}>
          No rule chosen yet. Pick the one that decides what counts.
        </p>
      )}
      <details className={styles.advanced}>
        <summary>Rule details and limits</summary>
        <p>
          The rule must cover your measurement dates. We check this before
          approval.
        </p>
        {choices.map((choice) => (
          <section key={choice.id}>
            <h4 className={styles.measureHeading}>
              {choice.name} · version {choice.version}
            </h4>
            <p>{choice.description}</p>
          </section>
        ))}
        {selected?.supported && (
          <ul className={styles.factList} aria-label="How this rule measures">
            {selected.qualifyingFacts?.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
            {!selected.qualifyingFacts?.length && (
              <li>
                Exact qualifying conditions are unavailable here. Inspect the
                saved rule in Success rules before review.
              </li>
            )}
            <li>
              Only wallets whose owners sign and agree to be measured can count.
              Signing alone isn’t a result.
            </li>
            <li>
              A result is credited to the last eligible creator touch in the 7
              days before it.
            </li>
            <li>Revenue isn’t counted by this rule.</li>
          </ul>
        )}
        {selected?.advancedFacts?.map((fact) => (
          <p key={fact}>{fact}</p>
        ))}
      </details>
      <details
        className={styles.advanced}
        open={choices.length === 0 && kind === "ready"}
      >
        <summary>Need a different rule?</summary>
        <p className={styles.small}>
          {canManage
            ? "Create a shared rule, then return here to choose it. Other plans stay unchanged."
            : "Ask a campaign manager to create a rule."}
        </p>
        <div className={styles.measureHelp}>
          {canManage && (
            <a className={styles.button} href={`${settingsHref}#create-rule`}>
              Create a new success rule version
            </a>
          )}
          <a className={styles.button} href={settingsHref}>
            View shared rules and history
          </a>
          {selectedId && canManage && !disabled ? (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonQuiet}`}
              onClick={() => onChoose(null)}
            >
              Clear rule choice
            </button>
          ) : null}
        </div>
      </details>
    </section>
  );
}
