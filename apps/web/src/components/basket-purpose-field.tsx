"use client";

import { useId, useRef } from "react";
import { listPreparedBaskets } from "@landed/contracts";
import styles from "./basket-strategy-editor.module.css";

const library = listPreparedBaskets();
const labels: Record<string, { goal: string; audience: string }> = {
  investor_reach: {
    goal: "Generate investor interest",
    audience: "Crypto-native investors",
  },
  tradfi_bridge: {
    goal: "Build finance-sector interest",
    audience: "Finance professionals and partners",
  },
  high_velocity_consumer: {
    goal: "Grow product adoption",
    audience: "Relevant consumer communities",
  },
};

/** Suggestions reuse editorial template wording, not matching scores or live rules. */
export function BasketPurposeField({
  field,
  value,
  onChange,
}: {
  field: "goal" | "audience";
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const helpId = useId();
  const detail = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const label = field === "goal" ? "Goal" : "Audience";
  const match = library.find((template) => template.strategy[field] === value);
  return (
    <div>
      <label>
        <span>
          {field === "goal"
            ? "What do you want to achieve?"
            : "Who do you want to reach?"}
          <span
            className="required-field-marker"
            aria-hidden="true"
            title="Required"
          />
        </span>
        <select
          name={`strategy-${field}-suggestion`}
          aria-required="true"
          data-required-missing={!value?.trim()}
          aria-label={`${label} starting point`}
          aria-describedby={helpId}
          value={match?.key ?? (value ? "custom" : "")}
          onChange={(event) => {
            if (event.target.value === "custom") {
              if (detail.current) detail.current.open = true;
              input.current?.focus();
              input.current?.select();
              return;
            }
            const suggestion = library.find(
              (template) => template.key === event.target.value,
            )?.strategy[field];
            if (!suggestion || suggestion === value) return;
            if (
              value &&
              !window.confirm(
                `Replace your current ${field} wording? Only this field changes, and only when you save strategy.`,
              )
            )
              return;
            onChange(suggestion);
            if (detail.current) detail.current.open = false;
          }}
        >
          <option value="" disabled>
            Choose a starting point
          </option>
          {library.map((template) => (
            <option key={template.key} value={template.key}>
              {labels[template.key]?.[field] ?? template.name}
            </option>
          ))}
          <option value="custom">Use my own wording</option>
        </select>
      </label>
      <p id={helpId}>
        {field === "goal"
          ? "The change you want this campaign to make."
          : "The people you want to influence, separate from your industry."}
      </p>
      {match && <p>{value}</p>}
      <details ref={detail} className={styles.detail} open={!match && !!value}>
        <summary>
          {value ? `Refine ${field} wording` : `Write your own ${field}`}
        </summary>
        <label>
          <span>
            {label}
            <span
              className="required-field-marker"
              aria-hidden="true"
              title="Required"
            />
          </span>
          <textarea
            ref={input}
            aria-label={label}
            name={`strategy-${field}`}
            aria-required="true"
            data-required-missing={!value?.trim()}
            autoComplete="off"
            maxLength={1000}
            rows={2}
            value={value ?? ""}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => onChange(event.target.value || null)}
          />
        </label>
      </details>
    </div>
  );
}
