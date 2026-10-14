"use client";

import { useId } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { reviewTime, utcFieldInstant } from "@/lib/review-time";
import type { CampaignTimingProposal } from "@landed/contracts";
import {
  type TimingField,
  type TimingFields,
} from "@/lib/baskets/timing-fields";
import styles from "./campaign-timing-fields.module.css";

const groups = [
  {
    title: "Campaign activity",
    description: "When will your creators deliver the campaign?",
    fields: [
      ["flightStart", "Activity starts"],
      ["flightEnd", "Activity ends"],
    ],
  },
  {
    title: "Measurement period",
    description:
      "How long should we measure eligible results? You can continue measuring after campaign activity ends.",
    fields: [
      ["measurementStart", "Measurement starts"],
      ["measurementEnd", "Measurement ends"],
    ],
  },
] as const;

/** Inline fields for the existing builder. The owner handles authenticated
 * saving and review invalidation; these controls never imply persistence. */
export function CampaignTimingFields({
  value,
  onChange,
  errors = {},
  disabled = false,
}: {
  value: TimingFields;
  onChange: (field: TimingField, value: string) => void;
  errors?: Partial<Record<TimingField, string>>;
  disabled?: boolean;
}) {
  const id = useId();
  const hydrated = useHydrated();
  return (
    <section className={styles.root} aria-labelledby={`${id}-title`}>
      <header>
        <h2 id={`${id}-title`}>Campaign dates</h2>
        <p id={`${id}-help`}>
          All dates and times are UTC. Each end time is the point when that
          period stops, not an additional day of activity. Enter UTC in these
          fields; the preview below each date also shows your browser’s local
          time. Saving dates does not approve the plan.
        </p>
      </header>
      <div className={styles.groups}>
        {groups.map((group) => (
          <fieldset key={group.title} disabled={disabled}>
            <legend>{group.title}</legend>
            <p>{group.description}</p>
            <div className={styles.inputs}>
              {group.fields.map(([key, label]) => (
                <div key={key}>
                  <label htmlFor={`${id}-${key}`}>
                    {label} (UTC)
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </label>
                  <input
                    id={`${id}-${key}`}
                    name={key}
                    type="datetime-local"
                    step="1"
                    autoComplete="off"
                    value={value[key]}
                    aria-required="true"
                    data-required-missing={!utcFieldInstant(value[key])}
                    onChange={(event) => onChange(key, event.target.value)}
                    aria-invalid={!!errors[key]}
                    aria-describedby={`${id}-help ${id}-${key}-preview${errors[key] ? ` ${id}-${key}-error` : ""}`}
                  />
                  <p id={`${id}-${key}-preview`}>
                    {utcFieldInstant(value[key])
                      ? `Time preview: ${reviewTime(utcFieldInstant(value[key])!, hydrated ? undefined : "UTC")}`
                      : "Enter a complete valid UTC date to see its time preview."}
                  </p>
                  {errors[key] ? (
                    <p
                      className={styles.error}
                      id={`${id}-${key}-error`}
                      aria-live="polite"
                    >
                      {errors[key]}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <p className={styles.note}>
        Measuring for longer does not add work for your creators or extend usage
        rights. Existing consent, tracking-link validity and attribution rules
        still apply. Choose Save dates to keep your changes.
      </p>
    </section>
  );
}

export function CampaignTimingSummary({
  timing,
  title = "Dates under review",
  label = "Campaign dates under review",
}: {
  timing: CampaignTimingProposal;
  title?: string;
  label?: string;
}) {
  const format = (value: string) => {
    const fraction = (value.split(".")[1]?.replace("Z", "") ?? "").replace(
      /0+$/,
      "",
    );
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "UTC",
    })
      .formatToParts(new Date(value))
      .map((part) =>
        part.type === "second" && fraction
          ? `${part.value}.${fraction}`
          : part.value,
      )
      .join("");
  };
  return (
    <section className={styles.root} aria-label={label}>
      <h3>{title}</h3>
      <dl className={styles.summary}>
        {groups.map((group, index) => {
          const period = index === 0 ? timing.flight : timing.measurement;
          return (
            <div key={group.title}>
              <dt>{group.title}</dt>
              <dd>
                <time dateTime={period.startedAt}>
                  {format(period.startedAt)} UTC
                </time>
                <span>to</span>
                <time dateTime={period.endedAt}>
                  {format(period.endedAt)} UTC
                </time>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className={styles.note}>
        Ends at the stated time. Measurement does not extend creator obligations
        or usage rights.
      </p>
    </section>
  );
}
