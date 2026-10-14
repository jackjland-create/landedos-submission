import { Status } from "@landed/ui";
import Link from "next/link";

import {
  pilotReadinessOpenItems,
  type PilotReadinessFixture,
  type PilotReadinessItemState,
  type PilotReadinessStepId,
} from "@/lib/pilot-readiness";

const itemStateCopy: Record<PilotReadinessItemState, string> = {
  complete: "COMPLETE",
  action: "NEEDS INPUT",
  blocked: "BLOCKED",
};

const itemTone: Record<
  PilotReadinessItemState,
  "verified" | "default" | "danger"
> = {
  complete: "verified",
  action: "default",
  blocked: "danger",
};

export function PilotReadinessCockpit({
  activeStepId,
  fixture,
  projectId,
  stepBasePath,
}: {
  activeStepId: PilotReadinessStepId;
  fixture: PilotReadinessFixture;
  projectId: string;
  stepBasePath?: string;
}) {
  const openItems = pilotReadinessOpenItems(fixture);
  const activeIndex = fixture.steps.findIndex(
    (step) => step.id === activeStepId,
  );
  const activeStep = fixture.steps[activeIndex] ?? fixture.steps[0]!;
  const completeCount = fixture.steps.reduce(
    (total, step) =>
      total + step.items.filter((item) => item.state === "complete").length,
    0,
  );
  const itemCount = fixture.steps.reduce(
    (total, step) => total + step.items.length,
    0,
  );
  const rehearsalReady = openItems.length === 0;
  const readinessPath =
    stepBasePath ?? `/projects/${projectId}/pilot-readiness`;
  const previousStep = fixture.steps[activeIndex - 1];
  const nextStep = fixture.steps[activeIndex + 1];

  return (
    <section className="pilot-readiness">
      <header className="pilot-readiness__header">
        <div>
          <span className="eyebrow">PILOT READINESS / {fixture.label}</span>
          <h1>Set the pilot up to succeed.</h1>
          <p>
            Five short decisions align the partner, outcome, campaign and
            safeguards. Live customer data remains a separate approval.
          </p>
        </div>
      </header>

      <section
        aria-labelledby="pilot-decision-heading"
        className={`pilot-readiness__decision ${
          rehearsalReady ? "pilot-readiness__decision--ready" : ""
        }`}
      >
        <div>
          <span className="eyebrow">CURRENT DECISION</span>
          <h2 id="pilot-decision-heading">
            {rehearsalReady
              ? "Ready for one bounded rehearsal."
              : `${openItems.length} decisions before rehearsal.`}
          </h2>
          <p>
            {rehearsalReady
              ? "The sanitized scope is complete. A named human can now record GO or NO-GO in the approved private operating system."
              : "Resolve the named inputs below. Incomplete evidence is never treated as zero, complete or approved."}
          </p>
        </div>
        <dl>
          <div>
            <dt>PARTNER</dt>
            <dd>{fixture.partnerLabel}</dd>
          </div>
          <div>
            <dt>CAMPAIGN</dt>
            <dd>{fixture.campaignLabel}</dd>
          </div>
          <div>
            <dt>READINESS</dt>
            <dd>
              <Status tone={rehearsalReady ? "verified" : "danger"}>
                {rehearsalReady ? "REHEARSAL READY" : "NOT READY"}
              </Status>
              <span>
                {completeCount} / {itemCount} checks complete
              </span>
            </dd>
          </div>
        </dl>
      </section>

      <div className="pilot-readiness__workspace">
        <nav aria-label="Pilot readiness steps" className="pilot-step-nav">
          <ol>
            {fixture.steps.map((step) => {
              const openCount = step.items.filter(
                (item) => item.state !== "complete",
              ).length;
              const active = step.id === activeStep.id;
              return (
                <li key={step.id}>
                  <Link
                    aria-current={active ? "step" : undefined}
                    className={active ? "pilot-step-nav__link--active" : ""}
                    href={`${readinessPath}?step=${step.id}`}
                  >
                    <span>{step.index}</span>
                    <strong>{step.title}</strong>
                    <small>
                      {openCount === 0 ? "COMPLETE" : `${openCount} TO RESOLVE`}
                    </small>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <article className="pilot-step">
          <header className="pilot-step__header">
            <span className="eyebrow">
              STEP {activeStep.index} /{" "}
              {fixture.steps.length.toString().padStart(2, "0")}
            </span>
            <h2>{activeStep.question}</h2>
            <p>{activeStep.why}</p>
          </header>

          <div className="pilot-step__items">
            {activeStep.items.map((item) => (
              <section className="pilot-readiness-item" key={item.id}>
                <div>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
                <div className="pilot-readiness-item__owner">
                  <span>OWNER</span>
                  <strong>{item.owner}</strong>
                </div>
                <div className="pilot-readiness-item__state">
                  <Status tone={itemTone[item.state]}>
                    {itemStateCopy[item.state]}
                  </Status>
                  {item.actionLabel && item.actionPath ? (
                    <Link
                      className="pilot-readiness-item__action"
                      href={item.actionPath(projectId)}
                    >
                      {item.actionLabel}
                    </Link>
                  ) : null}
                </div>
              </section>
            ))}
          </div>

          <footer className="pilot-step__footer">
            <div>
              <span>EVIDENCE CREATED</span>
              <p>{activeStep.evidence}</p>
            </div>
            <div className="pilot-step__controls">
              {previousStep ? (
                <Link
                  className="action-button action-button--secondary"
                  href={`${readinessPath}?step=${previousStep.id}`}
                >
                  PREVIOUS
                </Link>
              ) : null}
              {nextStep ? (
                <Link
                  className="action-button"
                  href={`${readinessPath}?step=${nextStep.id}`}
                >
                  NEXT / {nextStep.title.toUpperCase()}
                </Link>
              ) : (
                <span className="pilot-step__boundary">
                  HUMAN DECISION ONLY / LIVE DATA STILL FAIL CLOSED
                </span>
              )}
            </div>
          </footer>
        </article>
      </div>

      <aside className="pilot-readiness__boundary">
        <strong>REHEARSAL IS NOT LIVE AUTHORISATION</strong>
        <p>
          Customer or mainnet traffic still requires the private PIL-01 record,
          current PIL-02 controls, healthy monitoring and named human approval.
        </p>
        <Link href={`/projects/${projectId}/settings/integrations`}>
          VIEW SEPARATE LIVE-DATA CONTROLS
        </Link>
      </aside>
    </section>
  );
}
