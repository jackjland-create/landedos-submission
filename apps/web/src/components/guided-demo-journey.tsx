"use client";

import Link from "next/link";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { guidedDemoSteps, withGuidedDemo } from "@/lib/guided-demo";

const storageKey = "landed.guided-demo.v1";

type GuideState = {
  active: boolean;
  open: boolean;
  currentStep: number;
};

const initialState: GuideState = {
  active: false,
  open: false,
  currentStep: 0,
};

function isGuideState(value: unknown): value is GuideState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GuideState>;
  return (
    typeof candidate.active === "boolean" &&
    typeof candidate.open === "boolean" &&
    Number.isInteger(candidate.currentStep) &&
    candidate.currentStep !== undefined &&
    candidate.currentStep >= 0 &&
    candidate.currentStep <= guidedDemoSteps.length
  );
}

function readInitialGuide(): GuideState {
  if (typeof window === "undefined") return initialState;

  const params = new URL(window.location.href).searchParams;
  const requestedStep = Number(params.get("demoStep"));
  const requestedComplete = params.get("demoComplete") === "1";
  const requested = params.get("demo") === "1";
  let restored = initialState;

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "null",
    );
    if (isGuideState(stored)) restored = stored;
  } catch {
    // Storage may be unavailable (not merely malformed). URL state still works.
  }

  if (!requested) return restored;

  return {
    ...restored,
    active: true,
    open: params.get("demoOpen") !== "0",
    currentStep: requestedComplete
      ? guidedDemoSteps.length
      : Number.isInteger(requestedStep) &&
          requestedStep >= 1 &&
          requestedStep <= guidedDemoSteps.length
        ? requestedStep - 1
        : restored.currentStep,
  };
}

function subscribeToHydration() {
  return () => undefined;
}

export function GuidedDemoJourney({ projectId }: { projectId: string }) {
  const [guide, setGuide] = useState<GuideState>(readInitialGuide);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const restoreLauncherFocusRef = useRef(false);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!guide.open) {
      if (restoreLauncherFocusRef.current) {
        restoreLauncherFocusRef.current = false;
        launcherRef.current?.focus();
      }
      return;
    }

    const panel = panelRef.current;
    const shell = panel?.closest(".app-shell");
    const hiddenSiblings = shell
      ? Array.from(shell.children).filter((child) => child !== panel)
      : [];
    const previousOverflow = document.documentElement.style.overflow;
    hiddenSiblings.forEach((element) => element.setAttribute("inert", ""));
    document.documentElement.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      hiddenSiblings.forEach((element) => element.removeAttribute("inert"));
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [guide.open]);

  function updateGuide(next: GuideState) {
    setGuide(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Navigation carries guide state even when browser storage is disabled.
    }
  }

  function syncGuideUrl(next: GuideState, visible: boolean) {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.delete("demoStep");
    url.searchParams.delete("demoComplete");
    url.searchParams.delete("demoOpen");
    if (visible) {
      url.searchParams.set("demo", "1");
      if (next.currentStep === guidedDemoSteps.length) {
        url.searchParams.set("demoComplete", "1");
      } else {
        url.searchParams.set("demoStep", String(next.currentStep + 1));
      }
    }
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  function openGuide() {
    const next = { ...guide, active: true, open: true };
    updateGuide(next);
    syncGuideUrl(next, true);
  }

  function closeGuide() {
    restoreLauncherFocusRef.current = true;
    const next = { ...guide, open: false };
    updateGuide(next);
    syncGuideUrl(next, false);
  }

  function exitGuide() {
    restoreLauncherFocusRef.current = true;
    const next = { ...guide, active: false, open: false };
    updateGuide(next);
    syncGuideUrl(next, false);
  }

  function resetGuide() {
    const next = { active: true, open: true, currentStep: 0 };
    updateGuide(next);
    syncGuideUrl(next, true);
  }

  function keepFocusInsideGuide(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeGuide();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function advanceGuide(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    updateGuide({
      active: true,
      open: false,
      currentStep: Math.min(guide.currentStep + 1, guidedDemoSteps.length),
    });
  }

  function previousStep() {
    const next = {
      ...guide,
      currentStep: Math.max(guide.currentStep - 1, 0),
    };
    updateGuide(next);
    syncGuideUrl(next, true);
  }

  function returnToOperationalMode(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    exitGuide();
  }

  if (!hydrated) return null;

  const complete = guide.currentStep === guidedDemoSteps.length;
  const step = complete ? null : guidedDemoSteps[guide.currentStep]!;
  const completedSteps = complete ? guidedDemoSteps.length : guide.currentStep;

  if (!guide.open) {
    return (
      <button
        aria-label={guide.active ? "Resume guided demo" : "Open guided demo"}
        className="guided-demo-launcher"
        onClick={openGuide}
        ref={launcherRef}
        type="button"
      >
        <span>{guide.active ? "RESUME DEMO" : "GUIDED DEMO"}</span>
        <strong>
          {complete
            ? "COMPLETE"
            : `${String(guide.currentStep + 1).padStart(2, "0")} / 12`}
        </strong>
      </button>
    );
  }

  return (
    <aside
      aria-label="Guided demo journey"
      aria-modal="true"
      className="guided-demo"
      onKeyDown={keepFocusInsideGuide}
      ref={panelRef}
      role="dialog"
    >
      <header className="guided-demo__header">
        <div>
          <span>GUIDED CUSTOMER JOURNEY</span>
          <strong>{complete ? "12 / 12" : `${step!.index} / 12`}</strong>
        </div>
        <button
          aria-label="Close guided demo"
          onClick={closeGuide}
          ref={closeButtonRef}
          type="button"
        >
          CLOSE
        </button>
      </header>

      <div
        aria-label={`${completedSteps} of ${guidedDemoSteps.length} steps complete`}
        aria-valuemax={guidedDemoSteps.length}
        aria-valuemin={0}
        aria-valuenow={completedSteps}
        className="guided-demo__progress"
        role="progressbar"
      >
        {guidedDemoSteps.map((item, index) => (
          <span
            className={index < completedSteps ? "is-complete" : ""}
            key={item.id}
          />
        ))}
      </div>

      {complete ? (
        <div className="guided-demo__complete">
          <span>JOURNEY COMPLETE</span>
          <h2>From campaign intent to immutable evidence.</h2>
          <p>
            You have followed the sanitized customer journey through planning,
            measurement, reporting and replay. Operational records were not
            changed by the guide.
          </p>
          <Link
            className="guided-demo__primary"
            href={`/projects/${projectId}/overview`}
            onClick={returnToOperationalMode}
          >
            RETURN TO OPERATIONAL MODE
          </Link>
        </div>
      ) : (
        <div aria-live="polite" className="guided-demo__body">
          <div className="guided-demo__scroll">
            <div className="guided-demo__location">
              <span>YOU ARE HERE</span>
              <strong>{step!.location}</strong>
            </div>

            <div className="guided-demo__title">
              <span>STEP {step!.index}</span>
              <h2>{step!.title}</h2>
              <p>{step!.why}</p>
            </div>

            <dl className="guided-demo__facts">
              <div>
                <dt>READINESS</dt>
                <dd>{step!.readiness}</dd>
              </div>
              <div>
                <dt>EVIDENCE CREATED</dt>
                <dd>{step!.evidence}</dd>
              </div>
              <div>
                <dt>SUCCESS LOOKS LIKE</dt>
                <dd>{step!.success}</dd>
              </div>
              <div>
                <dt>NEXT</dt>
                <dd>{step!.next}</dd>
              </div>
            </dl>
          </div>

          <Link
            className="guided-demo__primary"
            href={withGuidedDemo(
              step!.path(projectId),
              guide.currentStep === guidedDemoSteps.length - 1
                ? "complete"
                : guide.currentStep + 2,
            )}
            onClick={advanceGuide}
          >
            {step!.actionLabel}
          </Link>
        </div>
      )}

      <footer className="guided-demo__footer">
        <button
          disabled={guide.currentStep === 0}
          onClick={previousStep}
          type="button"
        >
          PREVIOUS
        </button>
        <button onClick={resetGuide} type="button">
          RESET GUIDE
        </button>
        <button onClick={exitGuide} type="button">
          EXIT DEMO
        </button>
      </footer>
    </aside>
  );
}
