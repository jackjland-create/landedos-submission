"use client";
import { useEffect, useRef } from "react";
import {
  baseUnitsToDecimal,
  timedStrategyCommercialPlanSnapshotSchema,
} from "@landed/contracts";
import type { z } from "zod";
import styles from "./browser-commercial-dialog.module.css";

type Snapshot = z.infer<typeof timedStrategyCommercialPlanSnapshotSchema>;
function cashAmount(value: string) {
  const minor = BigInt(value);
  return `${new Intl.NumberFormat("en-GB").format(minor / 100n)}.${(minor % 100n).toString().padStart(2, "0")}`;
}

export function ApprovalTotals({ snapshot }: { snapshot: Snapshot }) {
  const totals = new Map<string, bigint>();
  let additional = false;
  const allUnpaid =
    snapshot.packages.length > 0 &&
    snapshot.packages.every(
      (entry) =>
        entry.commercialDetail?.schemaVersion === 2 &&
        entry.commercialDetail.commercialBasis === "unpaid_internal_test",
    );
  const commitmentLabel = allUnpaid
    ? "Commercial basis"
    : "Fixed total agreed, not paid";
  for (const entry of snapshot.packages)
    for (const line of entry.compensationLines) {
      if (line.assetType === "cash" && line.model === "fixed")
        totals.set(
          line.currencyCode,
          (totals.get(line.currencyCode) ?? 0n) + BigInt(line.amountMinor),
        );
      else additional = true;
    }
  return (
    <div className={styles.totals} aria-label={commitmentLabel}>
      <span>{commitmentLabel}</span>
      <div>
        {[...totals].map(([currency, minor]) => (
          <strong key={currency}>
            {currency} {cashAmount(minor.toString())}
          </strong>
        ))}
      </div>
      {!totals.size && (
        <strong>
          {allUnpaid
            ? "Unpaid internal test — no creator payment"
            : "No fixed cash commitment"}
        </strong>
      )}
      {additional && (
        <small>
          Plus variable or non-cash commitments shown above. Not an all-in
          total.
        </small>
      )}
    </div>
  );
}

export function ApprovalTermsTable({
  snapshot,
  selection,
}: {
  snapshot: Snapshot;
  selection?: {
    ids: string[];
    disabled: boolean;
    onChange: (ids: string[]) => void;
  };
}) {
  const all = useRef<HTMLInputElement>(null);
  const count = selection?.ids.length ?? 0;
  useEffect(() => {
    if (all.current)
      all.current.indeterminate = count > 0 && count < snapshot.packages.length;
  }, [count, snapshot.packages.length]);
  return (
    <table className={styles.table} role="table" data-selectable={!!selection}>
      <caption className={selection ? styles.selectionCaption : styles.srOnly}>
        {selection ? (
          <label>
            <input
              ref={all}
              type="checkbox"
              name="select-all-packages"
              aria-label="Select all packages for approval"
              checked={count === snapshot.packages.length && count > 0}
              disabled={selection.disabled}
              onChange={(event) =>
                selection.onChange(
                  event.target.checked
                    ? snapshot.packages.map((p) => p.id)
                    : [],
                )
              }
            />
            Select all
          </label>
        ) : (
          "Exact retained package terms for approval"
        )}
      </caption>
      <thead role="rowgroup">
        <tr role="row">
          {selection && (
            <th scope="col" role="columnheader">
              Select
            </th>
          )}
          {[
            "Creator / package",
            "Deliverables and channel",
            "Delivery dates",
            "Price",
            "Usage rights / exclusivity",
          ].map((label) => (
            <th key={label} scope="col" role="columnheader">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {snapshot.packages.map((entry) => (
          <tr key={entry.id} role="row">
            {selection && (
              <td role="cell" data-label="Selection">
                <label>
                  <input
                    type="checkbox"
                    name={`selected-package-${entry.id}`}
                    aria-label={`Select ${entry.packageLabel} for approval`}
                    checked={selection.ids.includes(entry.id)}
                    disabled={selection.disabled}
                    onChange={(event) =>
                      selection.onChange(
                        event.target.checked
                          ? [...selection.ids, entry.id]
                          : selection.ids.filter((id) => id !== entry.id),
                      )
                    }
                  />
                  <span className={styles.srOnly}>Select</span>
                </label>
              </td>
            )}
            <th scope="row" role="rowheader">
              <strong>
                {entry.commercialDetail?.creatorDisplayName ??
                  entry.packageLabel}
              </strong>
              <small>
                {entry.commercialDetail
                  ? entry.packageLabel
                  : "Retained package label"}
              </small>
              <details>
                <summary>Identity & source</summary>
                <dl>
                  <dt>Creator ID</dt>
                  <dd>{entry.creatorId}</dd>
                  <dt>Package ID</dt>
                  <dd>{entry.id}</dd>
                  <dt>Rate quote ID</dt>
                  <dd>{entry.sourceRateQuoteId ?? "Not specified"}</dd>
                </dl>
                <p>
                  {entry.commercialDetail
                    ? "Display identity retained at review; not identity verification."
                    : "Creator display name is not retained in this review."}
                </p>
              </details>
            </th>
            <td role="cell" data-label="Deliverables and channel">
              <p>{entry.deliverableSummary}</p>
              <small>
                {entry.commercialDetail?.channels.length
                  ? entry.commercialDetail.channels
                      .map(
                        (channel) =>
                          `${channel.channelType.toUpperCase()} · ${channel.handle}`,
                      )
                      .join(", ")
                  : "Channel: Not specified"}
              </small>
            </td>
            <td role="cell" data-label="Delivery dates">
              {entry.commercialDetail?.deliveryDeadline ? (
                <>
                  <time dateTime={entry.commercialDetail.deliveryDeadline}>
                    {new Intl.DateTimeFormat("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "UTC",
                    }).format(
                      new Date(entry.commercialDetail.deliveryDeadline),
                    )}{" "}
                    UTC
                  </time>
                  <details>
                    <summary>Exact deadline</summary>
                    {entry.commercialDetail.deliveryDeadline}
                  </details>
                </>
              ) : (
                <>
                  <span className={styles.notSpecified}>Not specified</span>
                  <small>No package deadline retained.</small>
                </>
              )}
            </td>
            <td role="cell" data-label="Price">
              {entry.commercialDetail?.schemaVersion === 2 &&
                entry.commercialDetail.commercialBasis ===
                  "unpaid_internal_test" && (
                  <div className={styles.price}>
                    <strong>Unpaid internal test</strong>
                    <small>{entry.commercialDetail.unpaidReason}</small>
                  </div>
                )}
              {entry.compensationLines.map((line) => (
                <div className={styles.price} key={line.id}>
                  <strong>
                    {line.assetType === "cash"
                      ? `${line.currencyCode} ${cashAmount(line.amountMinor)}`
                      : `${line.assetType.toUpperCase()} ${baseUnitsToDecimal(line.tokenAmountRaw, line.tokenDecimals)}`}
                  </strong>
                  <small>
                    {line.model === "fixed"
                      ? "Fixed"
                      : `Variable · per ${line.variableUnit ?? "unspecified unit"}`}
                  </small>
                  {line.assetType !== "cash" && (
                    <details>
                      <summary>Token valuation</summary>
                      <dl>
                        <dt>Mint</dt>
                        <dd>{line.tokenMint}</dd>
                        <dt>Unit price</dt>
                        <dd>USD {line.unitPriceUsd}</dd>
                        <dt>Source</dt>
                        <dd>{line.priceSource}</dd>
                        <dt>Valued at</dt>
                        <dd>{line.valuedAt}</dd>
                      </dl>
                    </details>
                  )}
                </div>
              ))}
            </td>
            <td role="cell" data-label="Usage rights / exclusivity">
              <p>
                Usage:{" "}
                {entry.commercialDetail?.usageRights ?? (
                  <span className={styles.notSpecified}>Not specified</span>
                )}
              </p>
              <p>
                Exclusivity:{" "}
                {entry.commercialDetail?.exclusivity ?? (
                  <span className={styles.notSpecified}>Not specified</span>
                )}
              </p>
              {!entry.commercialDetail?.usageRights ||
              !entry.commercialDetail?.exclusivity ? (
                <small>Not specified is not permission.</small>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ApprovalDates({ snapshot }: { snapshot: Snapshot }) {
  // Human-readable dates lead; exact UTC bounds retain all fractional precision in disclosure.
  const { flight, measurement } = snapshot.strategyBinding.timing;
  const display = (value: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(value));
  return (
    <div>
      <dl className={styles.dates}>
        <div>
          <dt>Campaign flight</dt>
          <dd>
            <time dateTime={flight.startedAt}>{display(flight.startedAt)}</time>
            <span> to </span>
            <time dateTime={flight.endedAt}>{display(flight.endedAt)}</time>
          </dd>
        </div>
        <div>
          <dt>Measurement window</dt>
          <dd>
            <time dateTime={measurement.startedAt}>
              {display(measurement.startedAt)}
            </time>
            <span> to </span>
            <time dateTime={measurement.endedAt}>
              {display(measurement.endedAt)}
            </time>
          </dd>
        </div>
      </dl>
      <details className={styles.exactTimes}>
        <summary>Exact times (UTC)</summary>
        <dl>
          <dt>Campaign flight</dt>
          <dd>
            {flight.startedAt} to {flight.endedAt}
          </dd>
          <dt>Measurement window</dt>
          <dd>
            {measurement.startedAt} to {measurement.endedAt}
          </dd>
        </dl>
      </details>
    </div>
  );
}
