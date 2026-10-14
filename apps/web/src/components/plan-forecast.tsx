import type {
  BasketPackageRecord,
  ExactCurrencyTotal,
  ScenarioForecastSummary,
  ScenarioSpendSummary,
} from "@landed/contracts";

import styles from "./campaign-plan.module.css";

/*
 * BSK-08 / UI-03 · campaign plan forecast strip (board 02/01, three tiles).
 * Presentation only: every number comes from the existing spend and forecast
 * calculations. The cost-per-qualified-wallet tile is a planning forecast
 * ("Target until results"), never observed efficiency. Money stays in integer
 * base units; nothing here uses floating-point arithmetic on money.
 */

const symbols: Record<ExactCurrencyTotal["currencyCode"], string> = {
  EUR: "€",
  GBP: "£",
  USD: "$",
};

function groupDigits(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatWholeAmount(
  currencyCode: ExactCurrencyTotal["currencyCode"],
  whole: string,
) {
  return `${symbols[currencyCode]}${groupDigits(whole)}`;
}

/** Cash amounts: whole units, or exactly two decimals when there are pence. */
export function formatExactTotal(total: ExactCurrencyTotal) {
  const [whole, fraction] = total.amount.split(".");
  const pence =
    fraction && /[1-9]/.test(fraction) ? `.${fraction.padEnd(2, "0")}` : "";
  return `${symbols[total.currencyCode]}${groupDigits(whole ?? "0")}${pence}`;
}

export type CostPerWallet =
  | {
      kind: "available";
      currencyCode: ExactCurrencyTotal["currencyCode"];
      /** Whole currency units, rounded half up. Low uses P75 wallets. */
      low: string;
      base: string;
      high: string;
    }
  | { kind: "unavailable"; reason: string };

function wholeUnitsPerWallet(units: bigint, scale: number, wallets: number) {
  const unit = 10n ** BigInt(scale);
  const divisor = BigInt(wallets) * unit;
  // Round half up without floating point: floor((2u + d) / 2d).
  return ((units * 2n + divisor) / (2n * divisor)).toString();
}

/**
 * Forecast cost per qualified wallet, following the builder's rule: complete
 * fixed cash terms in one currency, no variable, token or unpaid component, and
 * a ready forecast with positive wallet values. Low cost divides by P75, base
 * by base and high cost by P25. Anything else is unavailable, with a reason.
 */
export function costPerQualifiedWallet({
  spend,
  forecast,
  packages,
  packageIds,
}: {
  spend: ScenarioSpendSummary | undefined;
  forecast: ScenarioForecastSummary | undefined;
  packages: BasketPackageRecord[];
  packageIds: string[];
}): CostPerWallet {
  const unavailable = (reason: string): CostPerWallet => ({
    kind: "unavailable",
    reason,
  });
  if (!spend || spend.status === "empty" || packageIds.length === 0)
    return unavailable("Add creators to this scenario first.");
  if (spend.status === "incomplete" || spend.incompletePackageIds.length > 0)
    return unavailable("Shows once every included creator has terms.");
  if (spend.status === "mixed_currency")
    return unavailable(
      "Terms use more than one currency, so there's no single cost.",
    );
  if (spend.status === "unpaid" || spend.status === "variable_only")
    return unavailable("There's no fixed cash cost to divide.");
  if (spend.variableRates.length > 0)
    return unavailable("Variable terms are included, so the cost isn't fixed.");
  const included = packages.filter(({ id }) => packageIds.includes(id));
  if (
    included.some(
      (item) =>
        item.commercialDetail?.schemaVersion === 2 &&
        item.commercialDetail.commercialBasis === "unpaid_internal_test",
    )
  )
    return unavailable(
      "An unpaid test is included, so the cost isn't comparable.",
    );
  if (
    included.some(({ compensationLines }) =>
      compensationLines.some(
        (line) => line.assetType !== "cash" || line.model !== "fixed",
      ),
    )
  )
    return unavailable(
      "Token or variable terms are included, so the cost isn't fixed cash.",
    );
  const total = spend.fixedTotals[0];
  if (
    spend.status !== "single_currency" ||
    spend.fixedTotals.length !== 1 ||
    !total
  )
    return unavailable(
      "Shows once every included creator has fixed cash terms.",
    );
  if (!forecast || forecast.status !== "ready")
    return unavailable(
      forecast?.status === "partial"
        ? "Some included creators have no audience evidence, so the wallet forecast is partial."
        : "There's no wallet forecast for this scenario yet.",
    );
  const { p25, base, p75 } = forecast.qualifiedWallets;
  if (
    ![p25, base, p75].every((value) => Number.isSafeInteger(value) && value > 0)
  )
    return unavailable("The wallet forecast is too small to divide by.");
  const units = BigInt(total.units);
  return {
    kind: "available",
    currencyCode: total.currencyCode,
    low: wholeUnitsPerWallet(units, total.scale, p75),
    base: wholeUnitsPerWallet(units, total.scale, base),
    high: wholeUnitsPerWallet(units, total.scale, p25),
  };
}

const confidenceLabels: Record<ScenarioForecastSummary["confidence"], string> =
  {
    very_low: "Very low confidence",
    low: "Low confidence",
  };

function count(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function dateLabel(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function PlanForecast({
  forecast,
  assumptionLabel,
  spend,
  packages,
  packageIds,
  targetWallets,
  largestCreatorName,
}: {
  assumptionLabel?: string;
  forecast: ScenarioForecastSummary | undefined;
  spend: ScenarioSpendSummary | undefined;
  packages: BasketPackageRecord[];
  packageIds: string[];
  /** Only for a qualified-wallet outcome; other metrics are not wallets. */
  targetWallets: string | null;
  largestCreatorName: string | null;
}) {
  const cost = costPerQualifiedWallet({
    spend,
    forecast,
    packages,
    packageIds,
  });
  const ready =
    forecast && (forecast.status === "ready" || forecast.status === "partial");
  const wallets = forecast?.qualifiedWallets;
  const target = targetWallets ? Number(targetWallets) : 0;
  const scaleMax = Math.max(wallets?.p75 ?? 0, target, 1) * 1.15;
  const position = (value: number) =>
    `${Math.min((value / scaleMax) * 100, 100)}%`;
  const share = spend?.largestPackageShareBps ?? null;
  const included = packages.filter(({ id }) => packageIds.includes(id));
  // "Every creator has fixed terms" only when nothing included is variable,
  // token-valued or an unpaid test; a single fixed total alone isn't enough.
  const allFixed =
    !!spend &&
    spend.variableRates.length === 0 &&
    included.length > 0 &&
    included.every(
      (item) =>
        item.compensationLines.length > 0 &&
        item.compensationLines.every(
          (line) => line.assetType === "cash" && line.model === "fixed",
        ),
    );
  const fresh = dateLabel(forecast?.freshestObservedAt ?? null);

  return (
    <section
      className={`${styles.card} ${styles.forecast}`}
      aria-label="Forecast"
    >
      <section className={styles.tile} aria-labelledby="plan-tile-wallets">
        <h3 className={styles.tileLabel} id="plan-tile-wallets">
          Expected qualified wallets
        </h3>
        {ready && wallets ? (
          <>
            <p className={styles.figureRow}>
              <span className={styles.figure}>{count(wallets.base)}</span>
              <span className={styles.muted}>
                likely · range {count(wallets.p25)}–{count(wallets.p75)}
              </span>
            </p>
            <div className={styles.band} aria-hidden="true">
              <span className={styles.bandTrack} />
              <span
                className={styles.bandRange}
                style={{
                  left: position(wallets.p25),
                  width: `calc(${position(wallets.p75)} - ${position(wallets.p25)})`,
                }}
              />
              <span
                className={styles.bandMarker}
                style={{ left: position(wallets.base) }}
              />
              {target > 0 ? (
                <span
                  className={styles.bandTarget}
                  style={{ left: position(target) }}
                />
              ) : null}
            </div>
            <p className={styles.small}>
              {assumptionLabel ?? "Forecast · low · likely · high (P25 / base / P75)"}
              {targetWallets ? ` · target ${count(target)}` : ""}
            </p>
            <p className={styles.small}>
              {assumptionLabel ? "Synthetic audience context" : confidenceLabels[forecast.confidence]} · audience evidence for{" "}
              {forecast.sampleSize} of {forecast.includedPackageCount}{" "}
              {forecast.includedPackageCount === 1 ? "creator" : "creators"}
              {fresh ? ` · newest ${fresh}` : ""}
            </p>
            {forecast.status === "partial" ? (
              <p className={`${styles.small} ${styles.statusLine}`}>
                <span className={styles.dotUnavailable} aria-hidden="true" />
                {forecast.missingPackageIds.length} included{" "}
                {forecast.missingPackageIds.length === 1
                  ? "creator has"
                  : "creators have"}{" "}
                no audience evidence, so this is partial
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles.figureRow}>
              <span className={`${styles.figure} ${styles.figureEmpty}`}>
                Not available yet
              </span>
            </p>
            <p className={`${styles.small} ${styles.statusLine}`}>
              <span className={styles.dotUnavailable} aria-hidden="true" />
              Needs at least one included creator with dated audience evidence
            </p>
          </>
        )}
      </section>

      <section className={styles.tile} aria-labelledby="plan-tile-cost">
        <h3 className={styles.tileLabel} id="plan-tile-cost">
          Cost per qualified wallet
        </h3>
        {cost.kind === "available" ? (
          <>
            <p className={styles.figureRow}>
              <span className={styles.figure}>
                {symbols[cost.currencyCode]}
                {groupDigits(cost.base)}
              </span>
              <span className={styles.muted}>likely</span>
            </p>
            <p className={styles.muted}>
              Range {symbols[cost.currencyCode]}
              {groupDigits(cost.low)} – {symbols[cost.currencyCode]}
              {groupDigits(cost.high)}
            </p>
            <p className={`${styles.small} ${styles.pushDown}`}>
              Target until results · forecast · lower is better
            </p>
          </>
        ) : (
          <>
            <p className={styles.figureRow}>
              <span className={`${styles.figure} ${styles.figureEmpty}`}>
                Not available yet
              </span>
            </p>
            <p className={`${styles.small} ${styles.statusLine}`}>
              <span className={styles.dotUnavailable} aria-hidden="true" />
              {cost.reason}
            </p>
            <p className={`${styles.small} ${styles.pushDown}`}>
              Target until results · forecast · lower is better
            </p>
          </>
        )}
      </section>

      <section className={styles.tile} aria-labelledby="plan-tile-commitment">
        <h3 className={styles.tileLabel} id="plan-tile-commitment">
          Known fixed commitment
        </h3>
        {spend && spend.fixedTotals.length > 0 ? (
          <p className={styles.figureRow}>
            {spend.fixedTotals.map((total) => (
              <span className={styles.figure} key={total.currencyCode}>
                {formatExactTotal(total)}
              </span>
            ))}
            <span className={styles.muted}>agreed, not paid</span>
          </p>
        ) : (
          <p className={styles.figureRow}>
            <span className={`${styles.figure} ${styles.figureEmpty}`}>
              {spend?.status === "unpaid" ? "Unpaid test" : "None yet"}
            </span>
          </p>
        )}
        <p className={`${styles.small} ${styles.statusLine}`}>
          {spend?.status === "single_currency" && allFixed ? (
            <>
              <span className={styles.dotDone} aria-hidden="true" />
              Every included creator has fixed terms
            </>
          ) : (
            <>
              <span className={styles.dotUnavailable} aria-hidden="true" />
              {spend?.status === "single_currency"
                ? "This total covers the fixed terms only."
                : spend?.status === "incomplete"
                  ? `${spend.incompletePackageIds.length} included ${
                      spend.incompletePackageIds.length === 1
                        ? "creator has"
                        : "creators have"
                    } no complete terms, so this is a partial total`
                  : spend?.status === "mixed_currency"
                    ? "Currencies are shown separately. No conversion is applied."
                    : spend?.status === "variable_only"
                      ? "Only variable terms. They aren't part of a fixed total."
                      : spend?.status === "unpaid"
                        ? "Every included creator is an unpaid internal test."
                        : "Add creators and their terms to see a total."}
            </>
          )}
        </p>
        {spend && spend.variableRates.length > 0 ? (
          <p className={styles.small}>
            Plus variable:{" "}
            {spend.variableRates
              .map(
                (rate) => `${formatExactTotal(rate)} per ${rate.variableUnit}`,
              )
              .join(" · ")}
          </p>
        ) : null}
        {share !== null ? (
          share > 5000 ? (
            <p
              className={`${styles.small} ${styles.statusLine} ${styles.warnText}`}
            >
              <span className={styles.dotWarn} aria-hidden="true" />
              {largestCreatorName ?? "One creator"} is{" "}
              {share % 100 === 0
                ? `${share / 100}%`
                : `over ${Math.floor(share / 100)}%`}{" "}
              of fixed spend · review concentration
            </p>
          ) : (
            <p className={`${styles.small} ${styles.statusLine}`}>
              <span className={styles.dotDone} aria-hidden="true" />
              Largest creator is {Math.floor(share / 100)}% of fixed spend
            </p>
          )
        ) : null}
      </section>
    </section>
  );
}
