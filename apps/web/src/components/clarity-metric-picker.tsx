"use client";
import { useEffect, useRef } from "react";
import {
  defaultHeadlineMetrics,
  headlineMetrics,
  parseHeadlineMetrics,
  type HeadlineMetric,
} from "@/lib/reports/clarity";
import styles from "./clarity-reporting.module.css";

export function ClarityMetricPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = parseHeadlineMetrics(value);
  const pendingFocus = useRef<HeadlineMetric | null>(null);
  useEffect(() => {
    if (pendingFocus.current) {
      document.getElementById(`metric-order-${pendingFocus.current}`)?.focus();
      pendingFocus.current = null;
    }
  }, [value]);
  function move(index: number, delta: number) {
    pendingFocus.current = selected[index]!;
    const next = [...selected];
    [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
    onChange(next.join(","));
  }
  return (
    <>
      <p>
        Choose up to six headline metrics. Changes apply immediately to this
        preview URL only; they do not change the issued report, CSV, account
        preferences or another client’s view.
      </p>
      <fieldset className={styles.metricChoices}>
        <legend>Headline metrics</legend>
        {(Object.keys(headlineMetrics) as HeadlineMetric[]).map((key) => (
          <label key={key} className={styles.check}>
            <input
              type="checkbox"
              checked={selected.includes(key)}
              disabled={
                selected.includes(key)
                  ? selected.length === 1
                  : selected.length === 6
              }
              onChange={() =>
                onChange(
                  (selected.includes(key)
                    ? selected.filter((item) => item !== key)
                    : [...selected, key]
                  ).join(","),
                )
              }
            />
            {headlineMetrics[key]}
          </label>
        ))}
      </fieldset>
      <h3>Display order</h3>
      <ol className={styles.metricOrder}>
        {selected.map((key, index) => (
          <li
            key={key}
            id={`metric-order-${key}`}
            tabIndex={-1}
            aria-label={`${headlineMetrics[key]}, position ${index + 1} of ${selected.length}`}
          >
            <span>{headlineMetrics[key]}</span>
            <div>
              <button
                type="button"
                disabled={index === 0}
                aria-label={`Move ${headlineMetrics[key]} earlier`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === selected.length - 1}
                aria-label={`Move ${headlineMetrics[key]} later`}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>
      <section className={styles.termsSection}>
        <h3>Not available from this source</h3>
        <p>
          Impressions, reach and engagement need retained social observations.
          Connected-wallet and retention counts need their own sources. These
          are not substitutes for qualified or activated wallets.
        </p>
      </section>
      <button type="button" onClick={() => onChange(defaultHeadlineMetrics)}>
        Reset default metrics
      </button>
    </>
  );
}
