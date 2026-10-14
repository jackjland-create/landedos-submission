import Link from "next/link";
import { Eyebrow } from "@landed/ui";
import styles from "./campaign-cockpit-proposal.module.css";

export const cockpitViews = ["home", "campaign", "review", "audit"] as const;
export const cockpitStates = [
  "partial",
  "loading",
  "empty",
  "error",
  "permission",
] as const;
export type CockpitView = (typeof cockpitViews)[number];
export type CockpitState = (typeof cockpitStates)[number];
const base = "/visual-tests/reporting-studio/cockpit/";
const issued = "/visual-tests/reporting/ready?mode=decision";

function Periods() {
  return (
    <dl className={styles.periods}>
      <div>
        <dt>Campaign activity</dt>
        <dd>12–20 August · In flight</dd>
      </div>
      <div>
        <dt>Approved measurement</dt>
        <dd>12 August–10 September</dd>
      </div>
      <div>
        <dt>Reconciliation</dt>
        <dd>Evidence checks pending</dd>
      </div>
    </dl>
  );
}

function Metrics() {
  return (
    <div className={styles.metrics} aria-label="Illustrative campaign metrics">
      <div>
        <span>Qualified wallets</span>
        <strong>7</strong>
        <small>Strong attribution · partial coverage</small>
      </div>
      <div>
        <span>Qualified clicks</span>
        <strong>24</strong>
        <small>Retained observations, not a final total</small>
      </div>
      <div>
        <span>Campaign costs</span>
        <strong className={styles.unavailable}>Awaiting review</strong>
        <small>Cost basis not yet agreed</small>
      </div>
      <div>
        <span>Cost per outcome</span>
        <strong className={styles.unavailable}>Not available</strong>
        <small>Requires reviewed eligible costs</small>
      </div>
    </div>
  );
}

export function CampaignCockpitProposal({
  view,
  state = "partial",
}: {
  view: CockpitView;
  state?: CockpitState;
}) {
  const title =
    view === "home"
      ? "Your campaigns, in focus."
      : view === "campaign"
        ? "Helios Mobile Roster"
        : view === "review"
          ? "Review the report."
          : "Keep the depth. Change the hierarchy.";
  return (
    <div className={styles.proposal}>
      <aside className={styles.proposalNote} aria-label="Prototype boundary">
        <strong>Design proposal · BSK-09 / BRD-04</strong>
        <span>
          Illustrative data only. No live connection, records or approvals
          change.
        </span>
      </aside>
      <nav className={styles.journey} aria-label="Proposal journey">
        {(
          [
            ["home", "Home cockpit"],
            ["campaign", "Campaign detail"],
            ["review", "Report review"],
            ["audit", "What changes"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`${base}${key}`}
            aria-current={view === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <header className={styles.header}>
        <div>
          <Eyebrow>
            Helios Mobile /{" "}
            {view === "home" ? "Overview" : "Campaign workspace"}
          </Eyebrow>
          <h1>{title}</h1>
          <p>
            {view === "home"
              ? "Current performance and the next decision, before a report is issued."
              : "One campaign. Delivery, outcomes and decisions kept together."}
          </p>
        </div>
        {view === "home" && (
          <Link
            className="action-button action-button--primary"
            href={`${base}campaign`}
          >
            Review campaign
          </Link>
        )}
        {view === "campaign" && (
          <Link className="action-button" href={`${base}home`}>
            Back to overview
          </Link>
        )}
      </header>
      {view === "audit" ? (
        <Audit />
      ) : state !== "partial" ? (
        <State state={state} view={view} />
      ) : (
        <>
          <div className={styles.context}>
            <strong>Helios Mobile Roster</strong>
            <span>In flight</span>
            <span>Owner · Campaign manager</span>
          </div>
          <div className={styles.freshness}>
            <strong>Partial evidence</strong>
            <span>
              Illustrative data through 13 August, 11:55 UTC · Last eligible
              creator touch / 7 days · Strong attribution
            </span>
          </div>
          {view === "review" ? (
            <>
              <Periods />
              <Review />
            </>
          ) : (
            <>
              <Metrics />
              <Periods />
              <div className={styles.workArea}>
                <section
                  className={styles.focus}
                  aria-labelledby="next-decision"
                >
                  <Eyebrow>Next decision / campaign manager</Eyebrow>
                  <h2 id="next-decision">
                    Confirm which costs
                    <br />
                    count in your results.
                  </h2>
                  <p>
                    Performance stays visible while the campaign runs.
                    Cost-based metrics wait for an explicit, evidenced cost
                    review.
                  </p>
                  <Link
                    className="action-button action-button--primary"
                    href={`${base}review`}
                  >
                    See review requirements
                  </Link>
                </section>
                <section
                  className={styles.panel}
                  aria-labelledby="journey-title"
                >
                  <h2 id="journey-title">From attention to action</h2>
                  <p>
                    Observed in this illustrative scenario. Missing stages are
                    not treated as zero.
                  </p>
                  <ol className={styles.funnel}>
                    <li>
                      <span>Qualified clicks</span>
                      <strong>24</strong>
                    </li>
                    <li>
                      <span>Connected wallets</span>
                      <strong>Not available</strong>
                    </li>
                    <li>
                      <span>Qualified wallets</span>
                      <strong>7</strong>
                    </li>
                    <li>
                      <span>Retained wallets</span>
                      <strong>Not available</strong>
                    </li>
                  </ol>
                  <p className={styles.small}>
                    No conversion rate is inferred across missing stages.
                    Revenue and influenced volume remain separate.
                  </p>
                </section>
              </div>
              {view === "campaign" && <CampaignDetail />}
            </>
          )}
        </>
      )}
      <details className={styles.states}>
        <summary>Review loading, empty, error and permission states</summary>
        <nav aria-label="Proposal states">
          {cockpitStates.map((item) => (
            <Link
              key={item}
              href={`${base}${view}?state=${item}`}
              aria-current={state === item ? "page" : undefined}
            >
              {item}
            </Link>
          ))}
        </nav>
      </details>
    </div>
  );
}

function CampaignDetail() {
  return (
    <section className={styles.panel} aria-labelledby="workspace-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="workspace-title">Campaign working area</h2>
          <p>
            Keep the operational workspace; improve the way you reach its
            detail.
          </p>
        </div>
        <Link href="/visual-tests/reporting/ready?mode=creators">
          Inspect existing creator results
        </Link>
      </div>
      <div className={styles.detailsGrid}>
        <details>
          <summary>Delivery & creator commitments</summary>
          <p>
            Brief, agreed packages, acceptance, content submissions and tracking
            stay in the full campaign workspace. No replacement tray or
            simplified approval path.
          </p>
          <p>This proposal does not simulate saving deliverables.</p>
        </details>
        <details>
          <summary>Creators & economics</summary>
          <p>
            Keep creator-level outcomes, selected terms, missing-cost warnings
            and confidence. Show customer campaign costs, not Landed operating
            costs.
          </p>
          <Link href="/visual-tests/reporting/ready?mode=economics">
            Inspect existing economics
          </Link>
        </details>
        <details>
          <summary>Activity, measurement & reconciliation</summary>
          <p>
            Activity ends on 20 August in this example. Measurement continues to
            its approved end on 10 September. Reconciliation checks
            late-arriving evidence inside that period; it does not extend
            creator work or measurement.
          </p>
          <p>
            Recommendation: show outstanding evidence checks and an accountable
            owner, not an invented fixed countdown.
          </p>
        </details>
        <details>
          <summary>Evidence & issued history</summary>
          <p>
            Keep metric definitions, confidence, transaction drill-down and
            immutable version comparison. A report records a reviewed result,
            not the only place to see performance.
          </p>
          <Link href={issued}>Inspect existing issued-report example</Link>
        </details>
      </div>
    </section>
  );
}

function Review() {
  return (
    <section className={styles.panel} aria-labelledby="review-title">
      <h2 id="review-title">Not ready to issue</h2>
      <p>
        Review is a human decision. Ending the campaign or receiving an
        execution receipt is not proof of complete data.
      </p>
      <ol className={styles.requirements}>
        <li>
          <strong>Agree the campaign cost basis</strong>
          <span>
            Owner · Commercial reviewer. Contracted, incurred and paid are
            different; no policy is selected by this proposal.
          </span>
        </li>
        <li>
          <strong>Verify source coverage and freshness</strong>
          <span>
            Owner · Campaign manager. Partial results stay visible; unavailable
            dimensions must remain explicit.
          </span>
        </li>
        <li>
          <strong>Confirm issuance timing and the exact period</strong>
          <span>
            Owner · Authorised reviewer. Interim issuance is unresolved.
            Reconciliation has no assumed duration.
          </span>
        </li>
      </ol>
      <div className={styles.reviewActions}>
        <button
          className="action-button"
          type="button"
          disabled
          aria-describedby="issuance-explanation"
        >
          Issue report unavailable
        </button>
        <Link
          className="action-button action-button--primary"
          href={`${base}campaign`}
        >
          Return to running campaign
        </Link>
      </div>
      <p id="issuance-explanation">
        This is a read-only proposal. Timed issuance remains disabled in the
        product.
      </p>
      <p>
        <Link href={issued}>View the existing issued-report example</Link> ·
        separate historical fixture, not the result of this review.
      </p>
    </section>
  );
}

function State({
  state,
  view,
}: {
  state: Exclude<CockpitState, "partial">;
  view: CockpitView;
}) {
  const content = {
    loading: [
      "Loading campaign evidence…",
      "Wait for the protected read. No values are shown until it completes.",
    ],
    empty: [
      "No running campaign yet.",
      "Your first campaign starts with a goal-led basket. Existing drafts stay in Baskets.",
    ],
    error: [
      "Campaign evidence could not be loaded.",
      "No campaign or approval was changed. Retry the protected read before making a decision.",
    ],
    permission: [
      "You do not have campaign access.",
      "Ask your workspace administrator to review your project membership. No campaign data is displayed.",
    ],
  }[state];
  return (
    <section className={styles.panel} aria-busy={state === "loading"}>
      <h2>{content[0]}</h2>
      <p role="status">{content[1]}</p>
      <Link href={`${base}${view}`}>Return to illustrative example</Link>
    </section>
  );
}

function Audit() {
  return (
    <section className={styles.panel}>
      <h2>Selective redesign, not a reporting rebuild.</h2>
      <p>
        Compare the current report below. These are proposed presentation
        changes, not approval of a new visual system.
      </p>
      <div className={styles.detailsGrid}>
        <div>
          <h3>Keep</h3>
          <p>
            Funnel, creator results and economics, metric definitions, evidence
            drawer, confidence, freshness and immutable version comparison.
          </p>
        </div>
        <div>
          <h3>Simplify</h3>
          <p>
            Technical labels, competing actions and repeated context. Put
            status, owner and next action together; expose detail on request.
          </p>
        </div>
        <div>
          <h3>Redesign</h3>
          <p>
            Overview as the running-campaign cockpit. A clear campaign
            drill-down and explicit report review, with performance visible
            before issuance.
          </p>
        </div>
        <div>
          <h3>Do not change</h3>
          <p>
            Campaign-building mechanics, commercial approvals, permissions,
            evidence retention, report calculations or the five product
            destinations.
          </p>
        </div>
      </div>
      <div className={styles.reviewActions}>
        <Link className="action-button" href={issued}>
          Current reporting screen
        </Link>
        <Link
          className="action-button"
          href="/visual-tests/reporting-studio/clarity/ready?theme=light"
        >
          Earlier Clarity direction
        </Link>
        <Link
          className="action-button action-button--primary"
          href={`${base}home`}
        >
          Proposed home
        </Link>
      </div>
    </section>
  );
}
