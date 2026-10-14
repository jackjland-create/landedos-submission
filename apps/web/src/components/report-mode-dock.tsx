"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { isReportMode, type ReportMode } from "@/lib/reports/modes";

const modes: Array<{ id: ReportMode; label: string }> = [
  { id: "funnel", label: "Funnel" },
  { id: "creators", label: "Creators" },
  { id: "economics", label: "Economics" },
  { id: "evidence", label: "Evidence" },
  { id: "decision", label: "Decision" },
];

export function ReportModeDock({
  funnel,
  creators,
  economics,
  evidence,
  decision,
  initialMode = "funnel",
}: Record<ReportMode, ReactNode> & { initialMode?: ReportMode }) {
  const [activeMode, setActiveMode] = useState<ReportMode>(initialMode);
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panels: Record<ReportMode, ReactNode> = {
    funnel,
    creators,
    economics,
    evidence,
    decision,
  };

  useEffect(() => {
    function restoreMode() {
      const requested = new URL(window.location.href).searchParams.get("mode");
      setActiveMode(isReportMode(requested) ? requested : "funnel");
    }

    window.addEventListener("popstate", restoreMode);
    return () => window.removeEventListener("popstate", restoreMode);
  }, []);

  function selectMode(mode: ReportMode) {
    setActiveMode(mode);
    const url = new URL(window.location.href);
    if (mode === "funnel") url.searchParams.delete("mode");
    else url.searchParams.set("mode", mode);
    window.history.pushState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  function selectFromKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % modes.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + modes.length) % modes.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = modes.length - 1;
    else return;

    event.preventDefault();
    const nextMode = modes[nextIndex]!;
    selectMode(nextMode.id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section className="report-mode-dock">
      <div
        aria-label="Report detail views"
        className="report-mode-dock__tabs"
        role="tablist"
      >
        {modes.map((mode, index) => {
          const selected = activeMode === mode.id;
          return (
            <button
              aria-label={`${(index + 1).toString().padStart(2, "0")} ${mode.label}`}
              aria-controls={`${baseId}-${mode.id}-panel`}
              aria-selected={selected}
              id={`${baseId}-${mode.id}-tab`}
              key={mode.id}
              onClick={() => selectMode(mode.id)}
              onKeyDown={(event) => selectFromKeyboard(event, index)}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span>{(index + 1).toString().padStart(2, "0")}</span>
              {mode.label}
            </button>
          );
        })}
      </div>
      {modes.map((mode) => (
        <div
          aria-labelledby={`${baseId}-${mode.id}-tab`}
          className="report-mode-dock__panel"
          hidden={activeMode !== mode.id}
          id={`${baseId}-${mode.id}-panel`}
          key={mode.id}
          role="tabpanel"
          tabIndex={0}
        >
          {panels[mode.id]}
        </div>
      ))}
    </section>
  );
}
