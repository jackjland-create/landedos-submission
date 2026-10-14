"use client";

import type { CreatorEconomicsResult } from "@landed/analytics";
import Image from "next/image";
import { clarityDate, clarityMoney, clarityRate } from "@/lib/reports/clarity";
import styles from "./clarity-reporting.module.css";

export type ClarityCreator = CreatorEconomicsResult["creators"][number];
const count = (value: number | null) =>
  value === null
    ? "Not available"
    : new Intl.NumberFormat("en-GB").format(value);

export function ClarityCreatorCanvas({
  rows,
  currency,
  group,
  selected,
  onGroup,
  onDetail,
  onSelect,
  allowSelection = true,
}: {
  rows: ClarityCreator[];
  currency: string;
  group: "creator" | "content";
  selected: string[];
  onGroup: (group: "creator" | "content") => void;
  onDetail: (id: string) => void;
  onSelect: (id: string) => void;
  allowSelection?: boolean;
}) {
  const ranked = [...rows].sort(
    (a, b) => (b.qualifiedWallets ?? -1) - (a.qualifiedWallets ?? -1),
  );
  return (
    <div className={styles.creatorCanvas}>
      <div
        className={styles.creatorModes}
        role="group"
        aria-label="Creator or content view"
      >
        <button
          type="button"
          aria-pressed={group === "creator"}
          onClick={() => onGroup("creator")}
        >
          By creator
        </button>
        <button
          type="button"
          aria-pressed={group === "content"}
          onClick={() => onGroup("content")}
        >
          By content
        </button>
      </div>
      {group === "creator" ? (
        <>
          <p className={styles.small}>
            Ordered by qualified wallets; tied counts share no implied rank.
            Unknown results stay unavailable. Costs use the issued eligible
            allocation.
          </p>
          <div className={styles.tableWrap}>
            <table>
              <caption className={styles.srOnly}>
                Creator comparison for the selected issued version
              </caption>
              <thead>
                <tr>
                  {allowSelection && <th scope="col">Select</th>}
                  <th scope="col">Creator</th>
                  <th scope="col">Spend</th>
                  <th scope="col">Qualified</th>
                  <th scope="col">Activated</th>
                  <th scope="col">Cost / qualified</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row) => (
                  <tr key={row.creatorId}>
                    {allowSelection && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.creatorName}`}
                          checked={selected.includes(row.creatorId)}
                          onChange={() => onSelect(row.creatorId)}
                        />
                      </td>
                    )}
                    <th scope="row">
                      {row.creatorName}
                      <small className={styles.creatorHandle}>
                        {row.creatorHandle ?? "Handle not retained"}
                      </small>
                    </th>
                    <td>
                      {row.allocation.status === "available"
                        ? clarityMoney(row.allocation.valueMinor, currency)
                        : "Not available"}
                    </td>
                    <td>{count(row.qualifiedWallets)}</td>
                    <td>{count(row.activatedWallets)}</td>
                    <td>{clarityRate(row.cpqwMinorDecimal, currency)}</td>
                    <td>
                      <button
                        type="button"
                        aria-label={`View ${row.creatorName} details`}
                        onClick={() => onDetail(row.creatorId)}
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <p>
            Publication evidence, not post-level performance. Views, engagement
            and asset-level outcome allocation are not retained in this report.
          </p>
          <div className={styles.contentGrid}>
            {ranked.flatMap((row) =>
              row.contentAssets.map((asset) => (
                <article className={styles.contentCard} key={asset.id}>
                  {asset.publicationEvidence?.thumbnailStatus === "available" &&
                  asset.publicationEvidence.thumbnailUrl ? (
                    <Image
                      src={asset.publicationEvidence.thumbnailUrl}
                      alt={`Retained preview: ${asset.label}`}
                      width={120}
                      height={80}
                      unoptimized
                    />
                  ) : (
                    <div className={styles.thumbnailMissing}>
                      Preview unavailable
                    </div>
                  )}
                  <div>
                    <h3>{asset.label}</h3>
                    <p>
                      {row.creatorName} ·{" "}
                      {asset.publicationEvidence?.platform ??
                        "Platform not retained"}
                    </p>
                    <p>{asset.status.replaceAll("_", " ")}</p>
                    <small>
                      {asset.publicationEvidence
                        ? `${asset.publicationEvidence.sourceLabel} · Observed ${clarityDate(asset.publicationEvidence.observedAt)}`
                        : "Publication evidence not retained at issue"}
                    </small>
                    <div className={styles.creatorModes}>
                      {asset.publishedUrl &&
                      /^https?:\/\//i.test(asset.publishedUrl) ? (
                        <a
                          href={asset.publishedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open published content (new tab)
                        </a>
                      ) : (
                        <span>Published link unavailable</span>
                      )}
                      <button
                        type="button"
                        onClick={() => onDetail(row.creatorId)}
                      >
                        View {row.creatorName} terms
                      </button>
                    </div>
                  </div>
                </article>
              )),
            )}
          </div>
        </>
      )}
      {group === "content" &&
        rows.length > 0 &&
        rows.every((row) => row.contentAssets.length === 0) && (
          <p role="status">
            No content assets were retained for these creators in this issued
            version.
          </p>
        )}
      {rows.length === 0 && (
        <p role="status">No creator evidence is retained for this selection.</p>
      )}
    </div>
  );
}

export function ClarityCreatorTerms({
  row,
  currency,
  onEvidence,
}: {
  row: ClarityCreator;
  currency: string;
  onEvidence: () => void;
}) {
  return (
    <>
      <p>
        {row.creatorHandle ?? "Handle not retained"} · Fixed terms retained with
        this issued report, not a current offer.
      </p>
      <section className={styles.termsSection}>
        <h3>Agreed deliverables</h3>
        <p>{row.package.packageLabel}</p>
        <p>{row.package.deliverableSummary}</p>
        <p>
          Full brief, flight dates and usage-rights detail are not retained in
          this report. Do not infer them from the package name.
        </p>
      </section>
      <section className={styles.termsSection}>
        <h3>Compensation</h3>
        <ul>
          {row.package.compensationLines.map((line) => (
            <li key={line.id}>
              {line.model.replaceAll("_", " ")} ·{" "}
              {line.assetType === "cash"
                ? clarityMoney(line.amountMinor, line.currencyCode)
                : `${line.assetType.toUpperCase()} · exact token terms in advanced detail`}
              {line.variableUnit ? ` / ${line.variableUnit}` : ""}
            </li>
          ))}
        </ul>
        <p>Agreed compensation and eligible report spend may differ.</p>
      </section>
      <section className={styles.termsSection}>
        <h3>Results & cost basis</h3>
        <dl className={styles.definitionGrid}>
          <div>
            <dt>Qualified / activated</dt>
            <dd>
              {count(row.qualifiedWallets)} / {count(row.activatedWallets)}
            </dd>
          </div>
          <div>
            <dt>Eligible allocated spend</dt>
            <dd>
              {row.allocation.status === "available"
                ? clarityMoney(row.allocation.valueMinor, currency)
                : `Not available: ${row.allocation.reason.replaceAll("_", " ")}`}
            </dd>
          </div>
          <div>
            <dt>Cost per qualified wallet</dt>
            <dd>{clarityRate(row.cpqwMinorDecimal, currency)}</dd>
          </div>
          <div>
            <dt>Cost per activation</dt>
            <dd>{clarityRate(row.cpaMinorDecimal, currency)}</dd>
          </div>
        </dl>
        <p>
          Creator revenue and ROAS are not allocated in this fixture. Human
          commercial review remains required.
        </p>
        <button type="button" className={styles.primary} onClick={onEvidence}>
          View creator evidence
        </button>
      </section>
      <details className={styles.termsSection}>
        <summary>Advanced retained terms</summary>
        <pre>{JSON.stringify(row.package, null, 2)}</pre>
      </details>
    </>
  );
}
