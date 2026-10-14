"use client";

import { AppShell } from "@/components/app-shell";
import { project } from "@/lib/demo-data";

export default function ConversionSettingsError({
  reset,
}: {
  reset: () => void;
}) {
  return (
    <AppShell
      activeSection={null}
      projectId={project.id}
      settingsSection="conversions"
      contentAppearance="application"
    >
      <div>
        <section className="directory-state" role="alert">
          <span className="eyebrow">SETTINGS / RECOVERABLE ERROR</span>
          <h2>Success rules could not be loaded.</h2>
          <p>No rule or report evidence was changed.</p>
          <button className="action-button" onClick={reset} type="button">
            Try again
          </button>
        </section>
      </div>
    </AppShell>
  );
}
