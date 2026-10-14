import {
  baseUnitsToDecimal,
  type BasketPackageRecord,
  type BasketScenarioRecord,
} from "@landed/contracts";
import Link from "next/link";

import styles from "./campaign-plan.module.css";

/*
 * BSK-08 / UI-03 · candidates table (board 02/01). Presentation only: ticking
 * uses the existing scenario assignment action; terms open in the existing
 * terms editor. Landed history has no reader yet, so it is shown as not
 * available rather than as "new" or as zero results.
 */

const symbols = { EUR: "€", GBP: "£", USD: "$" } as const;

function grouped(decimal: string, pad = false) {
  const [whole, fraction] = decimal.split(".");
  const tail =
    fraction && /[1-9]/.test(fraction)
      ? `.${pad ? fraction.padEnd(2, "0") : fraction}`
      : "";
  return `${(whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${tail}`;
}

function lineText(line: BasketPackageRecord["compensationLines"][number]) {
  const amount =
    line.assetType === "cash"
      ? `${symbols[line.currencyCode]}${grouped(baseUnitsToDecimal(line.amountMinor, 2), true)}`
      : `${grouped(baseUnitsToDecimal(line.tokenAmountRaw, line.tokenDecimals))} ${
          line.assetType === "usdc" ? "USDC" : "tokens"
        }`;
  return line.model === "variable"
    ? `${amount} per ${line.variableUnit ?? "unspecified unit"}`
    : `${amount} fixed`;
}

export function termsSummary(item: BasketPackageRecord): {
  label: string;
  detail: string | null;
  missing: boolean;
} {
  const unpaid =
    item.commercialDetail?.schemaVersion === 2 &&
    item.commercialDetail.commercialBasis === "unpaid_internal_test";
  if (item.compensationLines.length === 0)
    return unpaid
      ? {
          label: "Unpaid test",
          detail: "No payment commitment",
          missing: false,
        }
      : { label: "Terms needed", detail: null, missing: true };
  const [first, ...rest] = item.compensationLines;
  return {
    label: lineText(first!),
    detail: rest.length
      ? `+ ${rest.map(lineText).join(" · ")}`
      : first!.assetType === "cash"
        ? null
        : "Token value recorded with its price source",
    missing: false,
  };
}

function audienceText(item: BasketPackageRecord) {
  const parts: string[] = [];
  if (item.creatorHandle) parts.push(item.creatorHandle);
  if (item.audience) {
    parts.push(
      item.audience.channelType === "x" ? "X" : item.audience.channelType,
    );
    parts.push(
      new Intl.NumberFormat("en-GB", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(item.audience.size),
    );
  } else parts.push("Audience not recorded");
  return parts.join(" · ");
}

function initials(name: string) {
  return (
    name
      .split(/[\s/]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function PlanCandidates({
  packages,
  scenario,
  pendingKeys,
  blockersByPackage,
  canManage,
  addHref,
  notice,
  readOnlySnapshot = false,
  onToggle,
  onOpenTerms,
}: {
  packages: BasketPackageRecord[];
  scenario: BasketScenarioRecord;
  pendingKeys: Set<string>;
  blockersByPackage: Map<string, string[]>;
  canManage: boolean;
  addHref: string;
  notice: string;
  readOnlySnapshot?: boolean;
  onToggle: (packageId: string, included: boolean) => void;
  onOpenTerms: (packageId: string) => void;
}) {
  const included = packages.filter(({ id }) =>
    scenario.packageIds.includes(id),
  );
  return (
    <section
      className={`${styles.card} ${styles.candidates}`}
      aria-labelledby="plan-candidates-title"
      id="basket-roster"
      tabIndex={-1}
    >
      <div className={styles.candidatesHead}>
        <div>
          <h2 id="plan-candidates-title" className={styles.cardTitle}>
            {included.length} of {packages.length}{" "}
            {packages.length === 1 ? "candidate" : "candidates"} in scenario{" "}
            {scenario.code}
          </h2>
          <p className={styles.small}>
            {readOnlySnapshot
              ? "Selected creators for this synthetic plan · open terms to inspect each package"
              : "From your creator directory · tick to include in this scenario · open a creator’s terms with its button"}
          </p>
        </div>
        <Link className={styles.button} href={addHref}>
          {readOnlySnapshot ? "Browse creators" : "Add candidates"}
        </Link>
      </div>
      {notice ? (
        <p className={styles.inlineAlert} role="alert">
          {notice}
        </p>
      ) : null}
      {packages.length === 0 ? (
        <div className={styles.emptyState}>
          <h3 className={styles.stepTitle}>No creators in this plan yet</h3>
          <p className={styles.small}>
            Add candidates from your creator directory. You agree their terms
            here afterwards.
          </p>
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>
              Creators in this plan. Ticked creators are in scenario{" "}
              {scenario.code}.
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className={styles.visuallyHidden}>
                    In scenario {scenario.code}
                  </span>
                </th>
                <th scope="col">Creator</th>
                <th scope="col" className={styles.landedCol}>
                  Landed record
                </th>
                <th scope="col" className={styles.numeric}>
                  Terms
                </th>
                <th scope="col">
                  <span className={styles.visuallyHidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {packages.map((item) => {
                const isIncluded = scenario.packageIds.includes(item.id);
                const changeKey = `${scenario.id}:${item.id}`;
                const terms = termsSummary(item);
                const blockers = blockersByPackage.get(item.id) ?? [];
                const needsTerms =
                  isIncluded && (terms.missing || blockers.length > 0);
                const actionLabel = !canManage
                  ? "View terms"
                  : needsTerms
                    ? terms.missing
                      ? "Add terms"
                      : "Fix terms"
                    : "Edit terms";
                return (
                  <tr
                    key={item.id}
                    id={`basket-package-${item.id}`}
                    className={needsTerms ? styles.rowAttention : undefined}
                  >
                    <td>
                      <input
                        className={styles.checkbox}
                        type="checkbox"
                        checked={isIncluded}
                        disabled={!canManage || pendingKeys.has(changeKey)}
                        onChange={(event) =>
                          onToggle(item.id, event.target.checked)
                        }
                        aria-label={`Include ${item.creatorName} in scenario ${scenario.code}`}
                      />
                    </td>
                    <td>
                      <div className={styles.creator}>
                        <span className={styles.avatar} aria-hidden="true">
                          {initials(item.creatorName)}
                        </span>
                        <div className={styles.creatorText}>
                          <strong>{item.creatorName}</strong>
                          <span className={styles.small}>
                            {item.packageLabel} · {audienceText(item)}
                          </span>
                          <span
                            className={`${styles.small} ${styles.statusLine} ${styles.landedInline}`}
                          >
                            <span
                              className={styles.dotUnavailable}
                              aria-hidden="true"
                            />
                            Landed record not available yet
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className={styles.landedCol}>
                      <span className={`${styles.small} ${styles.statusLine}`}>
                        <span
                          className={styles.dotUnavailable}
                          aria-hidden="true"
                        />
                        Not available yet
                      </span>
                    </td>
                    <td className={styles.numeric}>
                      {terms.missing ? (
                        <span className={styles.pillAttention}>
                          Terms needed
                        </span>
                      ) : (
                        <>
                          <strong className={styles.terms}>
                            {terms.label}
                          </strong>
                          {terms.detail ? (
                            <span
                              className={`${styles.small} ${styles.termsDetail}`}
                            >
                              {terms.detail}
                            </span>
                          ) : null}
                        </>
                      )}
                      {blockers.length > 0 && isIncluded && !terms.missing ? (
                        <span className={`${styles.small} ${styles.warnText}`}>
                          {blockers[0]}
                        </span>
                      ) : null}
                    </td>
                    <td className={styles.actionCell}>
                      <button
                        type="button"
                        className={`${styles.button} ${needsTerms && canManage ? styles.buttonAttention : ""}`}
                        onClick={() => onOpenTerms(item.id)}
                        aria-label={`${actionLabel} for ${item.creatorName}`}
                      >
                        {actionLabel}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className={`${styles.small} ${styles.cardFoot}`}>
        Packages are shared across scenarios. Unticking changes scenario{" "}
        {scenario.code} only. Terms are agreed drafts, not payments.
      </p>
    </section>
  );
}
