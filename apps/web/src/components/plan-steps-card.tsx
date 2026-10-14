import styles from "./campaign-plan.module.css";

/*
 * BSK-08 / UI-03 · "5 steps to approval" (journey board 02a). Presentation
 * only: the caller derives each step's status from saved state. A step is
 * Done only when its saved state is complete, never because inputs are filled.
 */

export type PlanStepStatus =
  "done" | "todo" | "unsaved" | "checking" | "unavailable";

export type PlanStep = {
  id: string;
  title: string;
  status: PlanStepStatus;
  /** One short line: what is saved, or what is missing. */
  summary: string;
  /** Optional second line, e.g. the rule name. */
  detail?: string;
  actionLabel: string;
  onAction: () => void;
  /** Disables the button, e.g. while identity is being checked. */
  actionDisabled?: boolean;
};

const statusWords: Record<PlanStepStatus, string> = {
  done: "Done",
  todo: "To do",
  unsaved: "Unsaved",
  checking: "Checking",
  unavailable: "Not available",
};

export function PlanStepsCard({
  steps,
  title,
  intro,
  footer,
  locked = false,
  currentId = null,
}: {
  steps: PlanStep[];
  title?: string;
  intro: string;
  footer?: string;
  locked?: boolean;
  /** The open step; locked plans are viewed, not edited. */
  currentId?: string | null;
}) {
  const done = steps.filter(({ status }) => status === "done").length;
  return (
    <section
      className={`${styles.card} ${styles.steps}`}
      aria-labelledby="plan-steps-title"
      id="plan-steps"
      tabIndex={-1}
    >
      <div className={styles.stepsHead}>
        <h2 id="plan-steps-title" className={styles.cardTitle}>
          {title ?? `${steps.length} steps to approval`}
        </h2>
        <span className={styles.muted}>
          {locked ? "Locked" : `${done} of ${steps.length} done`}
        </span>
      </div>
      <p className={styles.small}>{intro}</p>
      <ol className={styles.stepList}>
        {steps.map((step, index) => {
          const needsYou = step.status === "todo" || step.status === "unsaved";
          const current = step.id === currentId;
          return (
            <li
              className={`${styles.step} ${current ? styles.stepCurrent : ""}`}
              key={step.id}
              data-step={step.id}
              aria-current={current ? "step" : undefined}
            >
              <span
                className={`${styles.stepNumber} ${
                  step.status === "done"
                    ? styles.stepNumberDone
                    : needsYou
                      ? styles.stepNumberTodo
                      : styles.stepNumberQuiet
                }`}
                aria-hidden="true"
              >
                {step.status === "done" ? "✓" : index + 1}
              </span>
              <div className={styles.stepBody}>
                <h3 className={styles.stepTitle}>
                  <span className={styles.visuallyHidden}>
                    Step {index + 1}:{" "}
                  </span>
                  {step.title}
                </h3>
                <p className={styles.stepSummary}>
                  <span
                    className={
                      step.status === "done"
                        ? styles.okWord
                        : needsYou
                          ? styles.todoWord
                          : styles.quietWord
                    }
                  >
                    {current
                      ? locked
                        ? "Viewing now"
                        : step.status === "unsaved"
                          ? "Editing now · unsaved"
                          : "Editing now"
                      : statusWords[step.status]}
                  </span>
                  {step.summary ? ` · ${step.summary}` : ""}
                </p>
                {step.detail ? (
                  <p className={styles.stepDetail}>{step.detail}</p>
                ) : null}
              </div>
              <button
                type="button"
                className={`${styles.button} ${needsYou ? styles.buttonAttention : ""}`}
                onClick={step.onAction}
                disabled={step.actionDisabled}
                aria-label={
                  step.actionLabel
                    .toLowerCase()
                    .includes(step.title.toLowerCase())
                    ? undefined
                    : `${step.actionLabel}: ${step.title}`
                }
              >
                {step.actionLabel}
              </button>
            </li>
          );
        })}
      </ol>
      {footer ? (
        <div className={styles.stepsFooter}>
          <span className={styles.stepNumberNext} aria-hidden="true">
            →
          </span>
          <p className={styles.small}>{footer}</p>
        </div>
      ) : null}
    </section>
  );
}
