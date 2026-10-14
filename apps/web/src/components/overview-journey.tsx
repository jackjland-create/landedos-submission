"use client";

import { useRouter } from "next/navigation";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  overviewPersonas,
  validBriefText,
  validBudget,
  type OverviewPersona,
  type OverviewReference,
} from "@/lib/reports/overview-reference";
import type { ReportVisualState } from "@/lib/reports/visual-fixtures";
import shared from "./clarity-reporting.module.css";
import styles from "./overview-journey.module.css";

const personaLabels = {
  returning: "Returning brand",
  new: "New brand",
  analyst: "Read-only analyst",
  creator: "Invited creator",
};
const root = "/visual-tests/reporting-studio/overview/";
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={shared.panel}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const modal = ref.current;
    modal?.showModal();
    return () => {
      modal?.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${shared.dialog} ${styles.dialog}`}
      aria-labelledby="journey-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id="journey-dialog">{title}</h2>
        <button type="button" onClick={close}>
          Close
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function OverviewJourney({
  persona,
  state,
  initialTheme,
  reference,
}: {
  persona: OverviewPersona;
  state: ReportVisualState;
  initialTheme: "light" | "dark";
  reference: OverviewReference;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [dialog, setDialog] = useState<
    "brief" | "creators" | "basket" | "offer" | null
  >(null);
  const [notice, setNotice] = useState("");
  const [scope, setScope] = useState("all");
  const [brief, setBrief] = useState("");
  const [savedBrief, setSavedBrief] = useState("");
  const [response, setResponse] = useState("");
  const [submission, setSubmission] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [offerAction, setOfferAction] = useState("Accept");
  const [counter, setCounter] = useState("");
  const router = useRouter();
  const reportLink = `/visual-tests/reporting-studio/clarity/${state}?theme=${theme}&version=2`;
  const analyst = persona === "analyst";
  useEffect(() => {
    const prior = document.documentElement.style.colorScheme;
    document.documentElement.style.colorScheme = theme;
    return () => {
      document.documentElement.style.colorScheme = prior;
    };
  }, [theme]);
  const changeTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    const url = new URL(location.href);
    url.searchParams.set("theme", next);
    history.replaceState(null, "", url);
  };
  const returnLink = `${root}${persona}?theme=${theme}`;
  const close = () => setDialog(null);
  const saveBrief = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validBriefText(brief)) return;
    setSavedBrief(brief.trim());
    close();
    setNotice(
      "Brief saved in this rehearsal. Commercial approval is still required. Nothing was sent or created in the live account.",
    );
  };
  const themeSwitch = (
    <button
      type="button"
      role="switch"
      aria-label="Dark mode"
      aria-checked={theme === "dark"}
      className={shared.themeToggle}
      onClick={changeTheme}
    >
      <span aria-hidden="true">Light</span>
      <span className={shared.toggleTrack} aria-hidden="true">
        <span />
      </span>
      <span aria-hidden="true">Dark</span>
    </button>
  );
  return (
    <div className={`${shared.app} ${styles.app}`} data-theme={theme}>
      <a className={shared.skip} href="#overview-main">
        Skip to overview
      </a>
      <div className={shared.preview}>
        <span>
          <b>Journey rehearsal</b> · Sample data only · No real login or changes
        </span>
        <label className={shared.inlineLabel}>
          Preview as
          <select
            aria-label="Preview as"
            value={persona}
            onChange={(e) => {
              router.push(`${root}${e.target.value}?theme=${theme}`);
            }}
          >
            {overviewPersonas.map((p) => (
              <option key={p} value={p}>
                {personaLabels[p]}
              </option>
            ))}
          </select>
        </label>
        {themeSwitch}
        <details>
          <summary>Review states</summary>
          <nav aria-label="Review states">
            {[
              "ready",
              "loading",
              "empty",
              "error",
              "permission",
              "partial",
              "stale",
            ].map((s) => (
              <a key={s} href={`${returnLink}&state=${s}`}>
                {s}
              </a>
            ))}
          </nav>
        </details>
      </div>
      <div className={styles.shell}>
        <aside className={styles.rail}>
          <div className={shared.wordmark}>
            LANDED<span>®</span>
          </div>
          <p>
            {persona === "creator" ? "Creator workspace" : "Helios"}
            <small>{personaLabels[persona]}</small>
          </p>
          <nav aria-label="Workspace">
            <a href={returnLink} aria-current="page">
              Overview
            </a>
            {reference?.kind === "operator" && (
              <>
                <a href="#campaigns">Campaigns</a>
                <button type="button" onClick={() => setDialog("creators")}>
                  Creators
                </button>
                <button type="button" onClick={() => setDialog("basket")}>
                  Baskets
                </button>
                <a href={reportLink}>Reports</a>
              </>
            )}
            {reference?.kind === "new" && (
              <a href="#brand-setup">Brand setup</a>
            )}
            {reference?.kind === "creator" && (
              <>
                <a href="#creator-brief">Your brief</a>
                <a href="#creator-submission">Deliverables</a>
              </>
            )}
          </nav>
          <small>
            Prototype roles are examples, not permissions. Real access will be
            checked on the server.
          </small>
        </aside>
        <main id="overview-main" className={styles.main}>
          <div
            role="status"
            aria-live="polite"
            className={notice ? styles.notice : undefined}
          >
            {notice}
          </div>
          {!reference ? (
            <section
              className={styles.boundary}
              aria-busy={state === "loading"}
            >
              <p className={shared.eyebrow}>{personaLabels[persona]}</p>
              <h1>
                {state === "loading"
                  ? "Preparing your workspace…"
                  : state === "permission"
                    ? "Workspace access is required"
                    : state === "empty"
                      ? "A fresh start for your workspace"
                      : "Your overview could not be loaded"}
              </h1>
              <p>
                {state === "permission"
                  ? "Ask the workspace owner for access. No campaign or creator data is loaded in this example."
                  : state === "empty"
                    ? "There is no work to display in this example. New brands start with their brief; creators need an invitation."
                    : state === "loading"
                      ? "Your next actions and permitted results will appear here."
                      : "No campaign has changed. Retry the sample workspace."}
              </p>
              {state === "loading" && (
                <div className={shared.skeleton} aria-hidden="true" />
              )}
              <a className={styles.action} href={returnLink}>
                Return to ready example
              </a>
            </section>
          ) : (
            <>
              {(state === "partial" || state === "stale") && (
                <div className={shared.warning} role="status">
                  <strong>
                    {state === "partial"
                      ? "Some sources are unavailable"
                      : "Source update delayed"}
                  </strong>
                  <span>
                    Review the source window before making a decision. Missing
                    data is not zero.
                  </span>
                </div>
              )}
              {reference.kind === "new" && (
                <>
                  <header className={styles.heading}>
                    <div>
                      <p className={shared.eyebrow}>Your first campaign</p>
                      <h1>Give your brand a clear starting point.</h1>
                      <p>
                        A short brief connects the audience, creators and
                        outcome.
                      </p>
                    </div>
                  </header>
                  <BrandSetup />
                </>
              )}
              {reference.kind === "operator" && (
                <>
                  <header className={styles.heading}>
                    <div>
                      <p className={shared.eyebrow}>Helios workspace</p>
                      <h1>
                        {analyst
                          ? "A clear view of the work."
                          : "Your campaigns. Your next move."}
                      </h1>
                      <p>
                        {analyst
                          ? "Read-only rehearsal. Operational changes belong to the campaign owner."
                          : "Plan, review and measure from one starting point."}
                      </p>
                    </div>
                    {!analyst && (
                      <a
                        className={styles.action}
                        href={`${root}new?theme=${theme}`}
                      >
                        Plan a campaign
                      </a>
                    )}
                  </header>
                  <div className={styles.scope}>
                    <label>
                      Campaign view
                      <select
                        aria-label="Campaign view"
                        value={scope}
                        onChange={(e) => setScope(e.target.value)}
                      >
                        <option value="all">All campaigns</option>
                        <option value="measured">Helios Mobile Roster</option>
                        <option value="draft">Next launch · draft</option>
                      </select>
                    </label>
                    <p>
                      Two rehearsal campaigns. Results below belong only to the
                      issued Mobile Roster report, never combined account
                      totals.
                    </p>
                  </div>
                  <div className={styles.grid}>
                    <section
                      className={styles.priority}
                      aria-labelledby="next-action"
                    >
                      <span className={styles.tag}>
                        {savedBrief
                          ? "Waiting for approval"
                          : "Needs your attention"}
                      </span>
                      <h2 id="next-action">
                        {savedBrief
                          ? "Your draft brief is ready for review."
                          : "Give the next launch a deliverable summary."}
                      </h2>
                      <p>
                        {savedBrief
                          ? "The commercial approver is the next owner. No approval is simulated automatically."
                          : "Next launch / creator package. The brief is missing the exact content the creator needs to produce."}
                      </p>
                      <small>
                        Owner:{" "}
                        {savedBrief
                          ? "Commercial approver"
                          : "Campaign manager"}{" "}
                        · Rehearsal blocker
                      </small>
                      {analyst ? (
                        <p>
                          Read-only: ask the campaign manager to resolve this.
                        </p>
                      ) : (
                        <button
                          className={shared.primary}
                          type="button"
                          onClick={() => {
                            setBrief(savedBrief);
                            setDialog("brief");
                          }}
                        >
                          {savedBrief
                            ? "Review draft brief"
                            : "Complete deliverable summary"}
                        </button>
                      )}
                    </section>
                    <section
                      className={shared.panel}
                      aria-labelledby="results-heading"
                    >
                      <div className={styles.sectionHeading}>
                        <h2 id="results-heading">
                          {scope === "draft"
                            ? "Draft campaign"
                            : "Latest campaign result"}
                        </h2>
                        {scope !== "draft" && (
                          <a href={reportLink}>Open report →</a>
                        )}
                      </div>
                      {scope === "draft" ? (
                        <p>
                          No measured results yet. A draft budget or forecast
                          must not appear as observed campaign performance.
                        </p>
                      ) : (
                        <>
                          <p>{reference.campaign} · Issued V2</p>
                          <div className={styles.metrics}>
                            <div>
                              <span>Spend</span>
                              <strong>{reference.metrics.spend}</strong>
                            </div>
                            <div>
                              <span>Qualified wallets</span>
                              <strong>
                                {reference.metrics.qualified ?? "Not available"}
                              </strong>
                            </div>
                            <div>
                              <span>Cost per activation</span>
                              <strong>{reference.metrics.cpa}</strong>
                            </div>
                            <div>
                              <span>Primary revenue</span>
                              <strong>{reference.metrics.revenue}</strong>
                            </div>
                          </div>
                          <small>
                            Data through {reference.through}. Historical demo
                            snapshot, not a live feed. Primary ROAS includes
                            verified + strong only; last eligible touch / 7
                            days.
                          </small>
                        </>
                      )}
                    </section>
                    <section
                      id="campaigns"
                      className={`${shared.panel} ${styles.campaigns}`}
                    >
                      <div className={styles.sectionHeading}>
                        <h2>From plan to next campaign</h2>
                        <span className={styles.tag}>Rehearsal stages</span>
                      </div>
                      <ol className={styles.journey}>
                        {[
                          "Brief",
                          "Roster",
                          "Distribution",
                          "Outcomes",
                          "Next plan",
                        ].map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                      {scope !== "draft" && (
                        <article className={styles.campaignRow}>
                          <div>
                            <h3>Helios Mobile Roster</h3>
                            <p>
                              Issued result · 3 creators · Source window 1–13
                              Aug 2026
                            </p>
                          </div>
                          <a href={reportLink}>Review outcomes →</a>
                        </article>
                      )}
                      {scope !== "measured" && (
                        <article className={styles.campaignRow}>
                          <div>
                            <h3>Next launch</h3>
                            <p>
                              {savedBrief
                                ? "Brief drafted · Awaiting commercial review"
                                : "Planning · Deliverable summary needed"}
                            </p>
                          </div>
                          {!analyst && (
                            <button
                              type="button"
                              onClick={() => {
                                setBrief(savedBrief);
                                setDialog("brief");
                              }}
                            >
                              Review draft
                            </button>
                          )}
                        </article>
                      )}
                    </section>
                    <Panel title="Keep the work moving">
                      <div className={styles.tools}>
                        <button
                          type="button"
                          onClick={() => setDialog("creators")}
                        >
                          <strong>Creator roster</strong>
                          <span>Review the 3 creators and their evidence</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDialog("basket")}
                        >
                          <strong>Basket workspace</strong>
                          <span>See what a commercial plan needs</span>
                        </button>
                        <a href={`${reportLink}&view=funnel`}>
                          <strong>Distribution funnel</strong>
                          <span>Follow attention through to outcomes</span>
                        </a>
                      </div>
                    </Panel>
                  </div>
                </>
              )}
              {reference.kind === "creator" && (
                <>
                  <header className={styles.heading}>
                    <div>
                      <p className={shared.eyebrow}>{reference.name}</p>
                      <h1>Your brief. Your next deliverable.</h1>
                      <p>
                        One invited campaign. Your own work, without the brand’s
                        private account data.
                      </p>
                    </div>
                  </header>
                  <div className={styles.grid}>
                    <section className={styles.priority}>
                      <span className={styles.tag}>
                        {response
                          ? "Response rehearsed"
                          : "Offer awaiting your review"}
                      </span>
                      <h2>{reference.campaign}</h2>
                      <p>{reference.offer}</p>
                      <p>
                        {response ||
                          "Review the scope before confirming a response."}
                      </p>
                      <button
                        type="button"
                        className={shared.primary}
                        onClick={() => setDialog("offer")}
                      >
                        Review offer
                      </button>
                      <small>
                        Illustrative invitation, not a live contract or payout.
                      </small>
                    </section>
                    <section id="creator-brief" className={shared.panel}>
                      <h2>Your campaign brief</h2>
                      <p>{reference.brief}</p>
                      <ul>
                        {reference.deliverables.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                      <p>
                        Questions go to the campaign owner. Brand budgets, other
                        creators’ rates and protected wallet evidence are not
                        part of this view.
                      </p>
                    </section>
                    <section id="creator-submission" className={shared.panel}>
                      <h2>Submit your content</h2>
                      <p>
                        Preview how a published URL reaches the campaign owner
                        for review.
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!/^https?:\/\//i.test(submission)) return;
                          setSubmitted(true);
                        }}
                      >
                        <label>
                          <span>
                            Published content URL
                            <span
                              className="required-field-marker"
                              aria-hidden="true"
                              title="Required"
                            />
                          </span>
                          <input
                            type="url"
                            name="contentUrl"
                            required
                            pattern="https?://.+"
                            autoComplete="off"
                            placeholder="https://example.com/your-content"
                            value={submission}
                            onChange={(e) => {
                              setSubmission(e.target.value);
                              setSubmitted(false);
                            }}
                          />
                        </label>
                        <button type="submit">Rehearse submission</button>
                        <p role="status">
                          {submitted
                            ? "Submission preview ready. Nothing was uploaded or sent; the brand has not approved it."
                            : "Use a sample URL. This stays in the current page only."}
                        </p>
                      </form>
                    </section>
                    <Panel title="Your results">
                      <p>
                        No brand-approved creator result is included in this
                        invitation example.
                      </p>
                      <p>
                        Shared results will appear here only after the brand
                        grants access. Profile ownership is not permission to
                        view a brand’s reports.
                      </p>
                    </Panel>
                  </div>
                </>
              )}
            </>
          )}
          <footer className={styles.footer}>
            BRD-04 · Local journey prototype · Refresh resets drafts ·
            Newake/Ade font files pending
          </footer>
        </main>
      </div>
      {dialog === "brief" && reference?.kind === "operator" && !analyst && (
        <Dialog title="Next launch: deliverable summary" close={close}>
          <p>
            Name the content, format and quantity. This is the exact input
            blocking the draft.
          </p>
          <form onSubmit={saveBrief}>
            <label>
              <span>
                Deliverable summary
                <span
                  className="required-field-marker"
                  aria-hidden="true"
                  title="Required"
                />
              </span>
              <textarea
                name="deliverableSummary"
                required
                maxLength={1000}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="One founder interview and one launch post"
              />
            </label>
            <button
              type="submit"
              className={shared.primary}
              disabled={!validBriefText(brief)}
            >
              Save rehearsal draft
            </button>
            <p>
              Local preview only. No campaign, offer, approval or payment is
              created.
            </p>
          </form>
        </Dialog>
      )}
      {dialog === "creators" && reference?.kind === "operator" && (
        <Dialog title="Your campaign creators" close={close}>
          <p>
            These are the Mobile Roster’s sample creators, not a public
            marketplace.
          </p>
          <ul className={styles.tools}>
            {reference.creators.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <a href={`${reportLink}&view=creators&creator=all`}>
            Review creator results and source evidence →
          </a>
          <p>
            Adding/importing creators is a separate production workflow; this
            prototype does not change the roster.
          </p>
        </Dialog>
      )}
      {dialog === "basket" && reference?.kind === "operator" && (
        <Dialog title="Prepare the next basket" close={close}>
          <ol>
            <li>Choose the campaign outcome and budget.</li>
            <li>Select creators, content and usage rights.</li>
            <li>Resolve missing terms and compare scenarios.</li>
            <li>Ask an authorised person to approve.</li>
          </ol>
          <p>
            {savedBrief
              ? "The rehearsal deliverable summary is ready. Remaining commercial terms still need approval."
              : "Start by resolving the next launch’s missing deliverable summary."}
          </p>
          {!analyst && (
            <button
              type="button"
              onClick={() => {
                setBrief(savedBrief);
                setDialog("brief");
              }}
            >
              Open required brief input
            </button>
          )}
          <p>This is a workflow preview, not a saved basket.</p>
        </Dialog>
      )}
      {dialog === "offer" && reference?.kind === "creator" && (
        <Dialog title="Rehearse your offer response" close={close}>
          <p>{reference.offer}. No response will be sent.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (offerAction === "Counter" && !validBriefText(counter)) return;
              setResponse(
                `${offerAction} response prepared locally. Not sent to the brand.`,
              );
              close();
            }}
          >
            <label>
              Your response
              <select
                value={offerAction}
                onChange={(e) => setOfferAction(e.target.value)}
              >
                <option>Accept</option>
                <option>Counter</option>
                <option>Decline</option>
              </select>
            </label>
            {offerAction === "Counter" && (
              <label>
                <span>
                  Proposed change
                  <span
                    className="required-field-marker"
                    aria-hidden="true"
                    title="Required"
                  />
                </span>
                <textarea
                  required
                  name="counterProposal"
                  value={counter}
                  onChange={(e) => setCounter(e.target.value)}
                />
              </label>
            )}
            <button type="submit" className={shared.primary}>
              Confirm rehearsal response
            </button>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function BrandSetup() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [audience, setAudience] = useState("");
  const [outcome, setOutcome] = useState("Qualified wallets");
  const [campaign, setCampaign] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [error, setError] = useState("");
  const first = useRef<HTMLInputElement>(null);
  const budgetInput = useRef<HTMLInputElement>(null);
  const labels = ["Brand", "Audience & outcome", "First campaign"];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      (step === 0 && !validBriefText(name)) ||
      (step === 1 && !validBriefText(audience)) ||
      (step === 2 && (!validBriefText(campaign) || !validBudget(budget)))
    ) {
      setError(
        "Complete the required fields. Budget must be a positive amount with up to 2 decimal places.",
      );
      if (step === 2 && validBriefText(campaign) && !validBudget(budget)) {
        budgetInput.current?.focus();
      } else {
        first.current?.focus();
      }
      return;
    }
    setError("");
    setStep(step + 1);
  };
  return (
    <div className={styles.setup} id="brand-setup">
      <section className={shared.panel}>
        <nav className={styles.steps} aria-label="Brand setup steps">
          {labels.map((s, i) => (
            <button
              key={s}
              type="button"
              disabled={i > step}
              aria-current={i === step ? "step" : undefined}
              onClick={() => {
                setStep(i);
                setError("");
              }}
            >
              {i + 1}. {s}
            </button>
          ))}
        </nav>
        {step < 3 ? (
          <form onSubmit={submit}>
            <h2>{labels[step]}</h2>
            <p>Use sample details. Inputs are not stored or sent anywhere.</p>
            {step === 0 && (
              <label>
                <span>
                  Brand name
                  <span
                    className="required-field-marker"
                    aria-hidden="true"
                    title="Required"
                  />
                </span>
                <input
                  ref={first}
                  name="brandName"
                  required
                  maxLength={120}
                  autoComplete="organization"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Helios"
                />
              </label>
            )}
            {step === 1 && (
              <>
                <label>
                  <span>
                    Who do you want to reach?
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                  <input
                    ref={first}
                    name="audience"
                    required
                    maxLength={500}
                    autoComplete="off"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="Mobile-first founders discovering Helios"
                  />
                </label>
                <label>
                  Primary campaign outcome
                  <select
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                  >
                    <option>Qualified wallets</option>
                    <option>Activated customers</option>
                    <option>Verified protocol revenue</option>
                  </select>
                </label>
                <p>
                  Choosing an outcome here is a draft intention, not a live
                  conversion rule.
                </p>
              </>
            )}
            {step === 2 && (
              <>
                <label>
                  <span>
                    Campaign name
                    <span
                      className="required-field-marker"
                      aria-hidden="true"
                      title="Required"
                    />
                  </span>
                  <input
                    ref={first}
                    name="campaignName"
                    required
                    maxLength={120}
                    autoComplete="off"
                    value={campaign}
                    onChange={(e) => setCampaign(e.target.value)}
                    placeholder="Autumn launch"
                  />
                </label>
                <div className={styles.formRow}>
                  <label>
                    <span>
                      Planned budget
                      <span
                        className="required-field-marker"
                        aria-hidden="true"
                        title="Required"
                      />
                    </span>
                    <input
                      ref={budgetInput}
                      name="budget"
                      required
                      inputMode="decimal"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      placeholder="5000.00"
                      aria-invalid={Boolean(error && !validBudget(budget))}
                      aria-describedby={
                        error ? "budget-note setup-error" : "budget-note"
                      }
                    />
                  </label>
                  <label>
                    Currency
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      <option>GBP</option>
                      <option>USD</option>
                      <option>EUR</option>
                    </select>
                  </label>
                </div>
                <p id="budget-note">
                  Planning only. No currency conversion, charge or funding takes
                  place.
                </p>
              </>
            )}
            {error && (
              <p id="setup-error" role="alert">
                {error}
              </p>
            )}
            <div className={styles.formRow}>
              {step > 0 && (
                <button type="button" onClick={() => setStep(step - 1)}>
                  Back
                </button>
              )}
              <button type="submit" className={shared.primary}>
                {step === 2 ? "Review draft plan" : "Continue"}
              </button>
            </div>
          </form>
        ) : (
          <div role="status">
            <span className={styles.tag}>Local draft ready</span>
            <h2>{campaign}</h2>
            <dl className={styles.review}>
              <dt>Brand</dt>
              <dd>{name}</dd>
              <dt>Audience</dt>
              <dd>{audience}</dd>
              <dt>Outcome</dt>
              <dd>{outcome}</dd>
              <dt>Planned budget</dt>
              <dd>
                {budget} {currency}
              </dd>
            </dl>
            <p>
              Next: select creators, build the basket and request commercial
              approval. No live campaign was created.
            </p>
            <button type="button" onClick={() => setStep(2)}>
              Edit draft plan
            </button>
          </div>
        )}
      </section>
      <aside className={styles.setupAside}>
        <p className={shared.eyebrow}>A useful starting point</p>
        <h2>The brief connects everything.</h2>
        <ol>
          <li>
            <strong>Know the brand</strong>
            <p>Keep positioning and audience in one place.</p>
          </li>
          <li>
            <strong>Choose the right creators</strong>
            <p>Use evidence and fit, not follower count alone.</p>
          </li>
          <li>
            <strong>Measure a real outcome</strong>
            <p>Agree what success means before spending.</p>
          </li>
        </ol>
        <p>
          Brand discovery, CRM sync and creator matching are not running in this
          rehearsal.
        </p>
      </aside>
    </div>
  );
}
